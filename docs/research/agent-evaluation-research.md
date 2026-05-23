# Agent Evaluation Research

Research compiled 2026-05-16. Covers industry best practices for evaluating LLM agents and a concrete strategy for Synapse's chat agent, extraction agent, RAG pipeline, and memory system.

## Industry State of the Art (2025-2026)

### Core Principles

1. **Start with 20-50 real test cases**, not synthetic. Early iterations have large effect sizes, so small samples suffice.
2. **Combine grader types**: code-based (deterministic schema/format checks), LLM-as-judge (semantic quality), and human review (calibration).
3. **Evaluate trajectories, not just final output** — 17% of agent failures are step-repetition and 14% are reasoning-action mismatches that produce correct-looking results through broken paths.
4. **Close the feedback loop** — production failures become offline eval cases. Most underused practice.
5. **Read transcripts** — Anthropic explicitly recommends this. Automated graders reject valid solutions more often than expected.

Reference: [Anthropic: Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

### Six Evaluation Dimensions


| Dimension                 | Measurement                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| **Task completion**       | Did the agent achieve the goal? (binary or rubric)                 |
| **Tool selection**        | Did it pick the right tools? (trajectory match or LLM judge)       |
| **Parameter accuracy**    | Were tool arguments correct? (schema validation)                   |
| **Trajectory efficiency** | Unnecessary steps, redundant calls?                                |
| **Faithfulness**          | Claims supported by retrieved context?                             |
| **Safety**                | Stayed within boundaries? (disallowed actions, sandbox violations) |


### LLM-as-Judge Patterns

Three primary patterns:

**Pointwise scoring** — Judge LLM scores a single output against a rubric (1-5 scale). Most common. Vulnerable to verbosity bias and position bias.

**Pairwise comparison** — Judge sees two outputs, picks the better one. Avoids difficulty of absolute scoring. Good for A/B testing prompts or models. Swapping presentation order can shift accuracy by >10%.

**Pass/fail with rubric** — Binary judgment against specific criteria. Fastest, most deterministic. Good for CI/CD gating.

Key advances:

- **Instance-specific rubrics**: Each eval item gets its own bespoke rubric with 10-40 criteria. Research (GER-Eval) shows LLMs can reliably generate interpretable rubrics but scoring reliability degrades in knowledge-intensive settings.
- **Multi-judge panels**: Run 2-3 different models as judges, take majority vote. Reduces individual model biases.
- **Calibration**: Apply confidence intervals and item response theory to judges themselves.

Best practice: Use clear rubrics, isolated judges per dimension, regular calibration against human experts. Combine code-based (fast, deterministic), model-based (semantic), and human graders (ground truth).

### Trajectory Evaluation

Fastest-evolving area. Final-output-only evaluation is insufficient.

- **Strict trajectory match**: Checks if tool call sequence matches a reference. Simple but brittle — agents find valid alternative paths.
- **LLM-judge trajectory review**: Judge reviews full tool call sequence against a rubric. More flexible. Can include reference trajectory as guidance without requiring exact match.
- **Process Reward Models (PRMs)**: Active research. AgentPRM evaluates each decision based on proximity to goal. Fine-grained but expensive to annotate.

What to measure in trajectories:

- Redundant tool calls (same tool, identical parameters)
- Error recovery (graceful tool failure handling)
- Step repetition (17% of failures)
- Reasoning-action mismatch (14% of failures)

Anthropic's take: Checking specific tool call sequences is too rigid. Grade what the agent produced, not the path it took. But trajectory review still catches inefficiency, intermediate hallucination, and unsafe actions.

### Offline vs Online Evaluation

**Offline (pre-deployment)**:

- Curated datasets with known-good outputs
- Runs in CI/CD on each agent change or model upgrade
- 20-50 tasks for early development, scaling to hundreds for mature systems

**Online (post-deployment)**:

- Scores real production traffic (sampled)
- Detects distribution drift — real user inputs differ from curated test sets
- Production failures get converted into offline eval cases (the feedback loop)

Most teams: heavy offline evals in CI/CD (automated, blocking) + lighter online evals in production (sampling, alerting). Human review for calibrating automated judges, not scoring thousands of examples.

### Frameworks and Tools

**Tier 1: Purpose-built agent eval platforms**


| Tool                                      | Highlights                                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Braintrust** (`braintrust.dev`)         | Full-platform eval + observability. SDK wrappers for major frameworks. "Loop" generates custom scorers from natural language. Offline datasets + online production scoring. |
| **LangSmith** (`langchain.com/langsmith`) | LangChain's platform. Multi-turn eval for agent conversations. Insights Agent auto-categorizes failure modes.                                                               |
| **Inspect AI** (`inspect.aisi.org.uk`)    | Open-source from UK AI Safety Institute. 200+ pre-built evals (GAIA, SWE-Bench). Docker sandboxing. VS Code log viewer.                                                     |
| **DeepEval** (`deepeval.com`)             | Open-source, pytest-like. G-Eval, task completion, hallucination, faithfulness metrics.                                                                                     |


**Tier 2: Observability with eval capabilities**


| Tool                            | Highlights                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| **Langfuse** (`langfuse.com`)   | MIT-licensed, self-hostable. Traces, prompt management, eval scoring. Best for data control. |
| **Arize Phoenix** (`arize.com`) | Open-source. Logs every call, built-in evaluators, prompt versioning.                        |


**Tier 3: Specialized**


| Tool                                       | Highlights                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **AgentEvals** (`langchain-ai/agentevals`) | Standalone trajectory evaluation. Strict match, LLM-judge, graph trajectory. Python + TypeScript.                  |
| **RAGAS** (`docs.ragas.io`)                | RAG-specific. Context Precision/Recall, Faithfulness, Response Relevancy. Recently extended with KG-aware metrics. |
| **EvalForge**                              | Framework-agnostic. Ingests trace JSON, scores quality, returns pass/fail for CI.                                  |


### Anti-Patterns

1. **Evaluating only final output.** Misses step-repetition and reasoning-action mismatch failures.
2. **Rigid trajectory matching.** Agents find valid alternative paths. Use LLM-judge or match on tool sets, not sequences.
3. **Trusting LLM judges without calibration.** Verbosity bias, position bias, style preferences. Calibrate against human annotations.
4. **Synthetic-only test sets.** Real user inputs have different distributions. Without production data flowing back, you optimize for the wrong cases.
5. **One mega-judge prompt.** Use isolated judges per dimension (correctness, faithfulness, safety).
6. **Auto-deploying based on eval scores alone.** Anthropic explicitly warns against this.
7. **Not versioning evals.** Changing an eval without versioning breaks historical comparison.

---

## Synapse-Specific Evaluation Strategy

### Existing Evaluation Surfaces

The codebase already emits rich evaluation data — it's not persisted or scored:


| Surface                                | Data                                             | Persisted?                           |
| -------------------------------------- | ------------------------------------------------ | ------------------------------------ |
| `AgentProgressEvent` (extraction)      | Every tool call, result, error, final extraction | No (consumed by UI, discarded)       |
| `ChatAgentProgress` (chat)             | Tool calls, text chunks, collected subgraph      | No (consumed by UI, discarded)       |
| `ExtractionDiff` in `useLLMStore.diff` | Pre-review entity list with add/merge decisions  | No (Zustand state, cleared on reset) |
| `lastUsage`                            | Input/output tokens, cost                        | No (reset after each run)            |
| `entity_sources` / `edge_sources`      | Provenance of who extracted what                 | **Yes** (DB)                         |
| Memory writes                          | `.kg/agent/memory/*.md`                          | **Yes** (filesystem)                 |
| `chat_messages`                        | Final response text                              | **Yes** (DB)                         |


Key files for instrumentation:

- `src/core/agent-loop.ts` — Extraction agent loop, emits `AgentProgressEvent`
- `src/ui/hooks/chat-agent-loop.ts` — Chat agent loop, emits `ChatAgentProgress`
- `src/ui/hooks/useLLMExtraction.ts` — Extraction orchestration, holds `ExtractionDiff`
- `src/ui/hooks/useChatSession.ts` — Chat session entry point
- `src/commands/chat-tool-executor.ts` — All chat tool implementations
- `src/memory/pipeline.ts` — Memory retrieval pipeline
- `src/commands/rag-commands.ts` — RAG retrieval (FTS + vector + 1-hop expansion)

### Phase 1: Trace Logging (Foundation)

Add persistent trace log so agent behavior can be analyzed after the fact.

**Schema**: An `agent_runs` table or JSON files with: timestamp, mode (chat/extraction/ingestion), full tool call sequence, token usage, duration, final output, and (for extraction) the pre-review diff.

**Hook points**:

- Extraction: Tap `AgentProgressEvent` stream in `agent-loop.ts` (every tool call already exposed via `tool_call` and `tool_result` events)
- Chat: Tap `ChatAgentProgress` events in `chat-agent-loop.ts` (same data in `turn` events with `toolName`, `toolInput`, `content`)
- Extraction quality: Snapshot `useLLMStore.diff` before user review modifies it — this is the pre-human-judgment extraction result

This unblocks all subsequent phases.

### Phase 2: Extraction Agent Eval (Highest ROI)

Entity extraction has the clearest quality signal because it can be measured against ground truth.


| Metric                | How to Measure                                                               |
| --------------------- | ---------------------------------------------------------------------------- |
| **Entity precision**  | % of extracted entities that are real/meaningful (LLM judge or human review) |
| **Entity recall**     | % of important entities missed (requires gold-standard annotation)           |
| **Relation accuracy** | Edges correct? Right source/target? Right label?                             |
| **Merge accuracy**    | When `entityResolution.findMatches()` suggests merge, is it correct?         |
| **Schema compliance** | Does raw LLM output parse via `extractionResultSchema`? (code grader)        |
| **Efficiency**        | Tool calls vs reference count; tokens consumed                               |


**Building the test set**: Save 20-30 real pages/documents already extracted. Store source content + manually verified "correct" entity set. Run extraction, diff against gold standard.

### Phase 3: Chat Agent Eval

Open-ended, so harder. Focus on tool selection quality and answer grounding.


| Metric                     | How to Measure                                                                  |
| -------------------------- | ------------------------------------------------------------------------------- |
| **Tool selection**         | For known query types, did agent use appropriate tools? (LLM judge with rubric) |
| **Answer faithfulness**    | Response grounded in graph data? (LLM judge: "does answer cite real nodes?")    |
| **Subgraph relevance**     | Are `collectedNodeIds` actually relevant to the query?                          |
| **Unnecessary tool calls** | Redundant/pointless calls (code: detect duplicate tool+params in trace)         |
| **Merge correctness**      | When `merge_nodes` called, was dedup justified?                                 |


### Phase 4: RAG Eval (Subsystem)

`retrieveRAGContext()` in `rag-commands.ts` is a separate evaluation target.


| Metric                     | How to Measure                                                |
| -------------------------- | ------------------------------------------------------------- |
| **Context precision**      | Are returned nodes relevant to query?                         |
| **Context recall**         | Does result set contain nodes needed to answer?               |
| **Source excerpt quality** | Are 1000-char truncated excerpts useful?                      |
| **FTS vs vector**          | Does RRF fusion improve over FTS-only when embeddings active? |


RAGAS is purpose-built for this — export query/context/answer triples and score them.

### Phase 5: Memory Eval (Subsystem)


| Metric                    | How to Measure                                                               |
| ------------------------- | ---------------------------------------------------------------------------- |
| **Retrieval relevance**   | Does `metadata-retriever.ts` return memories agent actually uses?            |
| **Write quality**         | Are `manage_memory` files useful in future sessions? (longitudinal tracking) |
| **Supersession accuracy** | When a memory is superseded, was that correct?                               |


### Recommended Implementation Order

1. **Trace logging** — persist every agent run's tool calls, tokens, output. Single `agent_runs` table with JSON `trace` column.
2. **Build 20 extraction test cases** from real content already extracted. Save source + verified entities.
3. **Code-based grader** — compare extraction output against gold entities (fuzzy name match, edge label match, count deltas).
4. **LLM-as-judge scorer** — for ambiguous cases (e.g., "is 'ML' a valid alias for 'Machine Learning'?").
5. **Run on every prompt/model change** — manual is fine early. Automate later.
6. **Chat agent eval** — once trace logging is in place and extraction eval is stable.
7. **RAG and memory eval** — lower signal-to-noise, come last.

Steps 1-4 get 80% of the value. Chat, RAG, and memory eval are important but have lower signal-to-noise and can follow.

---

## References

- [Anthropic: Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Anthropic: Building Effective AI Agents](https://resources.anthropic.com/building-effective-ai-agents)
- [OpenAI: Evaluate Agent Workflows](https://developers.openai.com/api/docs/guides/agent-evals)
- [OpenAI: Testing Agent Skills Systematically](https://developers.openai.com/blog/eval-skills)
- [LangChain: Trajectory Evals](https://docs.langchain.com/langsmith/trajectory-evals)
- [LangChain: AgentEvals Library](https://github.com/langchain-ai/agentevals)
- [Braintrust: Agent Evals Platforms](https://www.braintrust.dev/articles/top-5-platforms-agent-evals-2025)
- [Inspect AI](https://inspect.aisi.org.uk/)
- [RAGAS Documentation](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/)
- [Arize: Agent Trajectory Evaluations](https://arize.com/docs/ax/evaluate/evaluators/trace-and-session-evals/trace-level-evaluations/agent-trajectory-evaluations)
- [KG-Based RAG Evaluation Framework (paper)](https://arxiv.org/abs/2510.02549)
- [AgentPRM: Process Reward Models (paper)](https://arxiv.org/abs/2511.08325)
- [TRACE: Trajectory-Aware Evaluation (paper)](https://arxiv.org/html/2602.21230v1)

