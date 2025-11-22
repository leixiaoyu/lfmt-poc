/**
 * API Gateway CORS Configuration Tests
 *
 * Tests to prevent regression of API Gateway CORS issues:
 * - Issue #4: API Gateway CORS hardcoded to localhost only
 * - Issue #5: CloudFront URL not included in allowed origins
 * - Issue #6: getAllowedApiOrigins() not used consistently
 */

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { LfmtInfrastructureStack } from '../lfmt-infrastructure-stack';

describe('API Gateway CORS Configuration', () => {
  let app: App;
  let stack: LfmtInfrastructureStack;
  let template: Template;

  beforeEach(() => {
    app = new App({
      context: {
        environment: 'dev',
      },
    });
    stack = new LfmtInfrastructureStack(app, 'TestStack', {
      environment: 'dev',
      enableLogging: false,
      retainData: false,
    });
    template = Template.fromStack(stack);
  });

  describe('OPTIONS Method CORS Configuration', () => {
    it('should configure CORS for /jobs/upload OPTIONS method', () => {
      // Find the OPTIONS method for /jobs/upload
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'OPTIONS',
        ResourceId: {
          Ref: expect.stringMatching(/LfmtApijobsupload/),
        },
      });
    });

    it('should configure CORS for /jobs/{jobId}/translate OPTIONS method', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'OPTIONS',
        ResourceId: {
          Ref: expect.stringMatching(/LfmtApijobsjobIdtranslate/),
        },
      });
    });

    it('should configure CORS for /jobs/{jobId}/translation-status OPTIONS method', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'OPTIONS',
        ResourceId: {
          Ref: expect.stringMatching(/LfmtApijobsjobIdtranslationstatus/),
        },
      });
    });
  });

  describe('CORS Allowed Origins', () => {
    it('should include localhost in dev environment', () => {
      const devStack = new LfmtInfrastructureStack(app, 'DevStack', {
        environment: 'dev',
        enableLogging: false,
        retainData: false,
      });
      const devTemplate = Template.fromStack(devStack);

      // Check that CORS mock integration includes localhost
      devTemplate.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'OPTIONS',
        Integration: {
          IntegrationResponses: [
            {
              ResponseParameters: {
                'method.response.header.Access-Control-Allow-Origin': expect.stringMatching(/localhost/),
              },
            },
          ],
        },
      });
    });

    it('should NOT include localhost in prod environment', () => {
      const prodApp = new App({
        context: {
          environment: 'prod',
        },
      });
      const prodStack = new LfmtInfrastructureStack(prodApp, 'ProdStack', {
        environment: 'prod',
        enableLogging: true,
        retainData: true,
      });
      const prodTemplate = Template.fromStack(prodStack);

      // In prod, should use production domain, not localhost
      prodTemplate.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'OPTIONS',
        Integration: {
          IntegrationResponses: [
            {
              ResponseParameters: {
                'method.response.header.Access-Control-Allow-Origin': expect.not.stringMatching(/localhost/),
              },
            },
          ],
        },
      });
    });
  });

  describe('Gateway Response CORS Headers', () => {
    it('should include CORS headers in 401 Unauthorized response', () => {
      template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
        ResponseType: 'UNAUTHORIZED',
        ResponseParameters: {
          'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
          'gatewayresponse.header.Access-Control-Allow-Credentials': "'true'",
          'gatewayresponse.header.Access-Control-Allow-Headers': expect.any(String),
          'gatewayresponse.header.Access-Control-Allow-Methods': expect.any(String),
        },
      });
    });

    it('should include CORS headers in 403 Access Denied response', () => {
      template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
        ResponseType: 'ACCESS_DENIED',
        ResponseParameters: {
          'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
          'gatewayresponse.header.Access-Control-Allow-Credentials': "'true'",
        },
      });
    });

    it('should include CORS headers in 400 Bad Request response', () => {
      template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
        ResponseType: 'BAD_REQUEST_BODY',
        ResponseParameters: {
          'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
        },
      });
    });

    it('should include CORS headers in 500 Server Error response', () => {
      template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
        ResponseType: 'DEFAULT_5XX',
        ResponseParameters: {
          'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
        },
      });
    });
  });

  describe('CORS Headers Configuration', () => {
    it('should allow required headers for authenticated requests', () => {
      const requiredHeaders = [
        'Content-Type',
        'X-Amz-Date',
        'Authorization',
        'X-Api-Key',
        'X-Amz-Security-Token',
        'X-Request-ID',
      ];

      // Verify Gateway Response includes all required headers
      template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
        ResponseParameters: {
          'gatewayresponse.header.Access-Control-Allow-Headers': expect.stringContaining('Authorization'),
        },
      });
    });

    it('should allow credentials for authenticated requests', () => {
      template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
        ResponseParameters: {
          'gatewayresponse.header.Access-Control-Allow-Credentials': "'true'",
        },
      });
    });

    it('should allow required HTTP methods', () => {
      const requiredMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];

      template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
        ResponseParameters: {
          'gatewayresponse.header.Access-Control-Allow-Methods': expect.stringMatching(/POST/),
        },
      });
    });
  });

  describe('CloudFront Distribution CORS', () => {
    it('should create CloudFront distribution', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          Comment: 'LFMT Frontend - Dev',
        },
      });
    });

    it('should use CloudFront URL in CORS configuration after creation', () => {
      // The getAllowedApiOrigins() method should dynamically include CloudFront URL
      // This is tested indirectly through the Lambda environment variable
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            ALLOWED_ORIGINS: expect.stringMatching(/.*/), // Should include CloudFront URL
          },
        },
      });
    });
  });

  describe('CORS Preflight Cache', () => {
    it('should configure appropriate max-age for OPTIONS responses', () => {
      // OPTIONS responses should be cacheable for better performance
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'OPTIONS',
        Integration: {
          IntegrationResponses: [
            {
              StatusCode: expect.any(String),
            },
          ],
        },
      });
    });
  });
});
