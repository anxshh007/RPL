# RepoPilot AI — TestSheriff Architecture Specification
**Layer 3 Automated Test Discovery, Safe Execution & Verification**

---

## 1. System Topology & Layering

RepoPilot AI is structured into three discrete operational layers:

```mermaid
flowchart TD
    subgraph Layer1 ["Layer 1: Central Agent (Member 1)"]
        RP["RepoPilot LLM Agent"]
        DH["Diff Generator & Patch Review"]
        HG{"Human Approval Gate"}
        RP --> DH --> HG
    end

    subgraph Layer2 ["Layer 2: Dependency Analysis (Member 3)"]
        IL["ImpactLens AST Engine"]
        IL --> CG["Candidate Test Graph"]
    end

    subgraph Layer3 ["Layer 3: Verification (Member 4 - TestSheriff)"]
        TD["Module A: Test Discovery & 4-Tier Selection"]
        SE["Module B: Sandboxed Non-Shell Process Runner"]
        RPars["Module C: Conservative Result Parser"]
        MCP["Module D: Stdio MCP Server (JSON-RPC 2.0)"]
        UI["Module E: UI Presentation & Generative Dashboard"]

        TD --> SE
        SE --> RPars
        RPars --> VR["VerificationReport (Canonical)"]
        MCP --> TD
        MCP --> SE
        VR --> UI
    end

    HG -->|"Only Approved Changes"| TD
    CG -->|"Candidate Tests + Confidence"| TD
    VR -->|"Truthful Feedback (No Hallucinations)"| RP
```

---

## 2. Execution State Machine

TestSheriff transitions through 10 deterministic states defined for Member 5's UI integration:

```mermaid
stateDiagram-v2
    [*] --> discovering_tests: Request Received
    discovering_tests --> waiting_for_approval: Tests Identified
    waiting_for_approval --> ready_to_execute: Developer Approved
    waiting_for_approval --> verification_incomplete: Developer Rejected
    ready_to_execute --> running_tests: Process Spawned
    running_tests --> tests_passed: Exit Code 0 & 0 Failures
    running_tests --> tests_failed: Failures > 0
    running_tests --> execution_timed_out: Exceeded timeoutMs
    running_tests --> execution_cancelled: AbortSignal Triggered
    running_tests --> verification_incomplete: Collection / Runner Error
    running_tests --> unsupported_test_framework: Non-Pytest Framework
```

---

## 3. Four-Tier Test Selection Algorithm

To optimize speed without compromising verification integrity, TestSheriff selects tests via a prioritized multi-tier engine:

| Priority | Tier Name | Description | Source Tag | Default Confidence |
|---|---|---|---|---|
| **1** | **Explicit Tests** | Directly specified by the developer or agent workflow. | `explicit` | `high` |
| **2** | **ImpactLens Candidates** | Tests identified via AST and dependency graph impact analysis. | `impact` | `high` |
| **3** | **Conventional & Import-Based** | File name pairing (`test_<name>.py`) and static AST scanning of test file imports (`from module import ...`). | `convention` / `import` | `high` |
| **4** | **Repository Suite Fallback** | Broader workspace test discovery executed when no narrow mapping can be established. | `configuration` | `low` |

### Truthful Disclosure Rule
When Priority 1, 2, or 3 selects a targeted subset of tests, TestSheriff injects an explicit limitation into `VerificationReport.limitations`:
> *"Targeted subset of tests executed. Broader repository test suite was not run; untested edge cases may exist."*

---

## 4. MCP Communication Contract

TestSheriff exposes three canonical tools via JSON-RPC 2.0:
1. `discover_tests`: Inspects workspace test setups without executing code.
2. `run_tests`: Safely executes tests on allowlisted runners and returns a structured `VerificationReport`.
3. `get_test_results`: Retrieves cached reports by `requestId`.
