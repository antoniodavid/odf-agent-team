---
name: project-task-patterns
description: "Project Task Patterns. Trigger: project task, project.task, milestone, timesheet."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Project and Task Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  PROJECT & TASK PATTERNS                                                     ║
║  Project management, task workflows, and time tracking                       ║
║  Use for project modules, task automation, and resource planning             ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Module Setup

### Manifest Dependencies
```python
{
    'name': 'My Project Module',
    'version': '18.0.1.0.0',
    'depends': ['project'],  # Core project
    # Optional: 'hr_timesheet', 'project_forecast', 'sale_project'
    'data': [
        'security/ir.model.access.csv',
        'views/project_views.xml',
    ],
}
```

---


## Best Practices

1. **Use stages** for workflow, not custom fields
2. **Track dependencies** for complex projects
3. **Time tracking** - integrate with hr_timesheet
4. **Progress calculation** - automate based on subtasks/checklists
5. **Notifications** - notify on stage changes and deadlines
6. **Budget tracking** - link costs to timesheets
7. **Hierarchy** - use parent tasks for organization
8. **Templates** - create project templates for recurring types
9. **Access rights** - control visibility by project
10. **Reporting** - track velocity, burndown, etc.

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
