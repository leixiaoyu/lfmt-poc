# Pending Document Migration — Index

> **Purpose**: Track architecture documents that could not be migrated into the repository during PR #131 because their files were dataless in iCloud (Optimize Storage had evicted them locally). Each placeholder in this directory stands in for an original document so that cross-references do not break and the migration work is visible.
>
> **Action required**: For each entry below, retrieve the original file from iCloud and replace the placeholder content with the real document. Tracked via a follow-up issue (TBD).

## Placeholders

| #   | Placeholder                                                                                                                                  | Original file                                                           | Notes                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | [CODE_REVIEW_AGENT.md](./CODE_REVIEW_AGENT.md)                                                                                               | `CODE_REVIEW_AGENT.md`                                                  | Sentinel code-review persona / rubric for Gemini CLI.                       |
| 2   | [LFMT-Product-Requirements.md](./LFMT-Product-Requirements.md)                                                                               | `LFMT Product Requirements.md`                                          | Full product spec: functional requirements, user stories, success criteria. |
| 3   | [Long-Form-Translation-Service-Technical-Architecture-Design-v2.0.md](./Long-Form-Translation-Service-Technical-Architecture-Design-v2.0.md) | `Long-Form Translation Service - Technical Architecture Design v2.0.md` | V2 recommended architecture: components, data flow, deployment topology.    |
| 4   | [LFMT-Implementation-Plan-v2.md](./LFMT-Implementation-Plan-v2.md)                                                                           | `LFMT Implementation Plan v2.md`                                        | Phased implementation plan with milestones and dependencies.                |
| 5   | [Low-Level-Design-01.md](./Low-Level-Design-01.md)                                                                                           | `Low-Level Design - 01 ....md`                                          | Low-level design doc #1 (subsystem TBD).                                    |
| 6   | [Low-Level-Design-02.md](./Low-Level-Design-02.md)                                                                                           | `Low-Level Design - 02 ....md`                                          | Low-level design doc #2.                                                    |
| 7   | [Low-Level-Design-03.md](./Low-Level-Design-03.md)                                                                                           | `Low-Level Design - 03 ....md`                                          | Low-level design doc #3.                                                    |
| 8   | [Low-Level-Design-04.md](./Low-Level-Design-04.md)                                                                                           | `Low-Level Design - 04 ....md`                                          | Low-level design doc #4.                                                    |
| 9   | [Low-Level-Design-05.md](./Low-Level-Design-05.md)                                                                                           | `Low-Level Design - 05 ....md`                                          | Low-level design doc #5.                                                    |
| 10  | [Low-Level-Design-06.md](./Low-Level-Design-06.md)                                                                                           | `Low-Level Design - 06 ....md`                                          | Low-level design doc #6.                                                    |
| 11  | [Low-Level-Design-07.md](./Low-Level-Design-07.md)                                                                                           | `Low-Level Design - 07 ....md`                                          | Low-level design doc #7.                                                    |
| 12  | [Low-Level-Design-08.md](./Low-Level-Design-08.md)                                                                                           | `Low-Level Design - 08 ....md`                                          | Low-level design doc #8.                                                    |
| 13  | [Low-Level-Design-09.md](./Low-Level-Design-09.md)                                                                                           | `Low-Level Design - 09 ....md`                                          | Low-level design doc #9.                                                    |
| 14  | [Low-Level-Design-10.md](./Low-Level-Design-10.md)                                                                                           | `Low-Level Design - 10 ....md`                                          | Low-level design doc #10.                                                   |

## Migration process (for whoever unpins these)

1. On the machine holding the Obsidian vault, force-download each original file (`brctl download` on macOS) until it is materialized locally.
2. Verify the file is non-empty and readable.
3. Replace the corresponding placeholder in this directory with the real content (keep the filename or rename to a clean kebab-case variant; update links in [../WORKSPACE-CONTEXT.md](../WORKSPACE-CONTEXT.md) and [../GEMINI.md](../GEMINI.md) if renamed).
4. Remove the entry from the table above.
5. Once all 14 rows are cleared, delete this `pending/` directory.
