# Observed Coding Agent Issues

- Date/Time: 2026-02-05 19:21:27 +0530
- Task/Context: Editing files in pi-langlearn repo.
- What went wrong (root cause): Used the shell to invoke apply_patch instead of calling the apply_patch tool directly.
- Proposed guardrail: When modifying files, call the apply_patch tool directly and avoid routing it through exec_command.
