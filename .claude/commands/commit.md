---
description: Automatically stages all changes and creates a git commit with an AI-generated message.
allowed-tools: Bash(git add:*, git commit:*)
---
# Task: Automate Git Commit
Stage all modified and new files to git using `git add .`.
Then, create a clear and concise one-line commit message using semantic commit notation.
Finally, run `git commit` with the generated message.
! git add .
! git commit -m "$(claude -p "Generate a concise semantic commit message based on staged changes, outputting only the message itself.")"

