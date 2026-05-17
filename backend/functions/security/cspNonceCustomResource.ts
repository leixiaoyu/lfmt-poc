/**
 * CSP Style-Src Nonce — CloudFormation custom-resource handler (Issue #254).
 *
 * This Lambda is invoked by CloudFormation (via the CDK Provider framework
 * declared in `backend/infrastructure/lib/lfmt-infrastructure-stack.ts`) on
 * every `cdk deploy`. Its job is to:
 *
 *   1. Generate a cryptographically-random base64url nonce (≥16 bytes of
 *      entropy — well above the W3C CSP3 §6.7 recommendation).
 *   2. Read `index.html` from the frontend S3 bucket if present.
 *   3. Replace every literal `__CSP_NONCE__` token in that HTML with the
 *      fresh nonce, and re-upload to S3 with the same content-type and
 *      cache-control headers the CI rebuild-frontend step uses.
 *   4. Return the nonce via the `Data.Nonce` response field so that the
 *      CloudFront response-headers policy can interpolate it into the
 *      `style-src 'self' 'nonce-<value>'` directive (CDK passes the
 *      `customResource.getAttString('Nonce')` token down to `buildCsp`).
 *
 * Step 2 is idempotent and best-effort: on a first-ever stack deploy the
 * frontend bucket may not yet contain `index.html` (the CI rebuild step
 * runs after `cdk deploy`), so a `NoSuchKey` error is logged and ignored.
 * The CI-side `rebuild-frontend` composite action ALSO performs the same
 * placeholder replacement (using the nonce read back from the CFN output)
 * before uploading `dist/index.html` — this guards the deploy-ordering
 * case where the CI rebuild lands AFTER this custom resource has run.
 *
 * The trade-off (static nonce per deploy lifetime, not per response) is
 * documented in `docs/CLOUDFRONT-SETUP.md` under "Operational note:
 * deploy-time CSP nonce".
 *
 * ---------------------------------------------------------------------------
 * Why a Lambda-backed Provider framework custom resource (not AwsCustomResource)
 * ---------------------------------------------------------------------------
 *
 * `aws-cdk-lib/custom-resources.AwsCustomResource` can only invoke a single
 * AWS SDK call per lifecycle event — it cannot stitch a `GetObject` ->
 * `transform string in memory` -> `PutObject` sequence together. The work
 * here requires both the read and the write to run inside the same
 * execution context (so the freshly-generated nonce is used in BOTH), so
 * we use the Provider framework which lets us ship arbitrary handler code.
 *
 * ---------------------------------------------------------------------------
 * Always-runs-on-every-deploy invariant
 * ---------------------------------------------------------------------------
 *
 * CloudFormation only re-invokes a custom resource when one of its input
 * properties changes. The CDK stack passes `deployTimestamp` (a synth-time
 * `Date.now()` value) as a property of the custom resource, which causes
 * a fresh `Update` lifecycle event on every `cdk deploy`. The handler
 * therefore re-runs and a NEW nonce is generated.
 *
 * If a future contributor switches to a deterministic property (e.g. the
 * stack version), the resource will become idempotent and the nonce will
 * STOP rotating — re-read the rationale here before doing that.
 */

import { randomBytes } from 'crypto';
import { S3Client, GetObjectCommand, PutObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';
import type {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
} from 'aws-lambda';

// Single S3 client per Lambda container; region is auto-detected from the
// execution environment (LAMBDA_REGION) so this handler works in any of
// the dev/staging/prod stacks without an explicit `region` constructor
// argument.
const s3 = new S3Client({});

/**
 * Literal placeholder token that the build-time `frontend/index.html` ships
 * with. Keep in lockstep with the `<meta name="csp-nonce" content="__CSP_NONCE__">`
 * tag and the `.github/actions/rebuild-frontend/action.yml` sed pattern —
 * a future rename of any one of these three sites would silently break
 * the nonce pipeline (the CSP header would carry a fresh nonce while the
 * HTML would still ship the old placeholder, blocking every MUI style).
 */
const NONCE_PLACEHOLDER = '__CSP_NONCE__';

/**
 * S3 key under the frontend bucket where the SPA entry point lives. CDK
 * uploads (via the rebuild-frontend composite action) put `index.html` at
 * the bucket root; the constant is named explicitly so a future move to a
 * sub-prefix (e.g. `app/index.html`) only touches this one line.
 */
const INDEX_HTML_KEY = 'index.html';

/**
 * Cache-Control header the CI upload step applies to `index.html`. The
 * value is kept identical to `.github/actions/rebuild-frontend/action.yml`
 * (`public, max-age=0, must-revalidate`) so the re-upload here does not
 * accidentally turn the entry-point into a long-lived cached asset (which
 * would freeze the nonce mismatch in a CDN edge for the next 24h).
 */
const INDEX_HTML_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

/**
 * Generate a CSP-grade nonce. CSP3 §6.7 says the value must be at least 128
 * bits of entropy; `randomBytes(24)` gives 192 bits, with base64url encoding
 * producing a 32-character ASCII string that contains only nonce-source-safe
 * characters (no `'`, `;`, or whitespace that could break the CSP grammar).
 *
 * `base64url` encoding (RFC 4648 §5) replaces `+` and `/` with `-` and `_`
 * and strips padding `=` — none of which require quoting in a CSP header.
 */
export function generateNonce(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Replace every occurrence of the literal placeholder string with the given
 * nonce. Uses a global string-replacement loop rather than RegExp so a future
 * placeholder containing regex metacharacters (e.g. dots) still matches
 * verbatim.
 */
export function applyNonceToHtml(html: string, nonce: string): string {
  return html.split(NONCE_PLACEHOLDER).join(nonce);
}

interface CspNonceResourceProperties {
  /**
   * The frontend S3 bucket name (resolved from
   * `frontendBucket.bucketName` in the CDK stack).
   */
  bucketName: string;
  /**
   * Synth-time `Date.now()` value passed by the CDK stack so CloudFormation
   * detects a property change on every deploy and re-invokes this handler.
   * The value is not used by the handler itself; its only purpose is to
   * defeat the "no property change -> skip update" optimization.
   */
  deployTimestamp: string;
}

/**
 * Read the existing `index.html` from S3 and rewrite the nonce placeholder.
 * Returns `'absent'` when the object does not yet exist (first-ever deploy
 * before the CI rebuild step has uploaded an HTML bundle), in which case
 * the custom resource still completes successfully — the CI composite
 * action will perform the substitution on its own at upload time.
 */
async function rewriteIndexHtml(
  bucketName: string,
  nonce: string
): Promise<'rewritten' | 'absent' | 'no-placeholder'> {
  let html: string;
  try {
    const got = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: INDEX_HTML_KEY }));
    if (!got.Body) {
      // Defensive: a 200 with no body would be a malformed S3 response.
      // Treat it the same as a missing object — the CI rebuild will heal it.
      return 'absent';
    }
    html = await got.Body.transformToString('utf-8');
  } catch (err) {
    if (err instanceof NoSuchKey) {
      // First-ever deploy: bucket created by this same `cdk deploy` is
      // empty; CI rebuild-frontend uploads `dist/index.html` afterwards
      // and does its own placeholder substitution at that time.
      return 'absent';
    }
    throw err;
  }

  if (!html.includes(NONCE_PLACEHOLDER)) {
    // The placeholder has already been replaced (e.g. by a previous deploy
    // OR by the CI composite action's pre-upload sed). In that case the
    // *currently-deployed* HTML has a stale nonce that no longer matches
    // the CSP header — we MUST re-upload with the fresh nonce, but we
    // can't simply re-substitute the placeholder (there isn't one). The
    // safest path is to log the mismatch and let the CI rebuild step
    // (which always re-stamps from the CFN output) heal it on the next
    // frontend upload. Returning 'no-placeholder' surfaces this in the
    // CloudWatch log without failing the deploy.
    return 'no-placeholder';
  }

  const rewritten = applyNonceToHtml(html, nonce);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: INDEX_HTML_KEY,
      Body: rewritten,
      ContentType: 'text/html',
      CacheControl: INDEX_HTML_CACHE_CONTROL,
    })
  );
  return 'rewritten';
}

/**
 * CloudFormation custom-resource handler entry point.
 *
 * Lifecycle events:
 *   - `Create` / `Update`: generate a fresh nonce, attempt the S3 rewrite,
 *     return `Data.Nonce` so the CSP response-headers policy picks up the
 *     value.
 *   - `Delete`: no-op — the CSP header and `index.html` will be cleaned
 *     up by the stack-deletion teardown of the response-headers policy
 *     and the frontend bucket itself.
 */
export async function handler(
  event: CloudFormationCustomResourceEvent
): Promise<CloudFormationCustomResourceResponse> {
  const requestType = event.RequestType;
  const physicalResourceId =
    'PhysicalResourceId' in event ? event.PhysicalResourceId : `csp-nonce-${event.RequestId}`;

  if (requestType === 'Delete') {
    return {
      Status: 'SUCCESS',
      PhysicalResourceId: physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: {},
    };
  }

  const props = event.ResourceProperties as unknown as CspNonceResourceProperties & {
    ServiceToken: string;
  };
  if (!props.bucketName) {
    throw new Error(
      `CspNonceCustomResource: missing required property 'bucketName' on ${requestType}`
    );
  }

  const nonce = generateNonce();
  const result = await rewriteIndexHtml(props.bucketName, nonce);

  // eslint-disable-next-line no-console -- intentional CloudWatch breadcrumb
  console.log(
    JSON.stringify({
      level: 'INFO',
      service: 'lfmt-csp-nonce-custom-resource',
      message: 'CSP nonce rotated',
      requestType,
      bucketName: props.bucketName,
      result, // 'rewritten' | 'absent' | 'no-placeholder'
      // Do NOT log the nonce itself — it ends up in the live CSP header
      // and the rendered `index.html`, both of which are public, but
      // a CloudWatch breadcrumb of every historical nonce is cheap
      // attacker recon (a single CloudTrail read enumerates them all).
    })
  );

  return {
    Status: 'SUCCESS',
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: {
      Nonce: nonce,
    },
  };
}
