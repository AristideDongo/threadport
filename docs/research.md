# Developer research plan

ThreadPort's main hypothesis is that a reviewed, evidence-backed handoff reduces the effort of resuming work or changing coding agents. Broad surveys identify concerns about AI accuracy, debugging, privacy, and workflow fit, but they do not establish demand for ThreadPort itself. See the [Stack Overflow 2025 survey](https://survey.stackoverflow.co/2025/ai), [JetBrains developer interviews](https://blog.jetbrains.com/research/2025/06/software-developers-on-ai/), and [DORA 2025 report](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report).

## Study

Recruit 8–12 developers who use at least one coding agent. Include people who switch agents and people who do not. Do not collect private code or transcripts without informed consent. Use a small public sample repository when possible.

Ask each participant to:

1. Resume a task after receiving a previous developer's notes.
2. Switch from one coding agent to another midway through a task.
3. Review a proposed agent change and decide whether it is ready to merge.

Run the tasks once with the participant's normal workflow and once with ThreadPort. Counterbalance the order. Observe where setup, context, verification, or privacy controls cause friction.

## Measures

- Time until the first correct next action.
- Missed decisions, unresolved tasks, or outdated assumptions.
- Incorrect changes caught before merge.
- Time spent producing and reviewing the handoff.
- Whether the participant can explain what was verified and on which Git state.
- Confidence in what data would be shared with an agent or export.

Ask which parts they would keep, remove, or change. Record role and tool mix, but avoid recording credentials or proprietary code. Publish aggregate findings and revise priorities before expanding to more providers or interfaces. No interviews have been conducted for this plan yet.
