---
name: attachment-binary-patterns
description: "Attachment Binary Patterns. Trigger: binary field, file attachment, ir.attachment, upload."
license: MIT
metadata:
  author: antoniodavid
  version: "1.0"
---

# Attachment and Binary Field Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  ATTACHMENT & BINARY FIELD PATTERNS                                          ║
║  File uploads, images, documents, and attachments                            ║
║  Use for handling files, images, and documents in Odoo                       ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Binary Field Types

| Field Type | Use Case |
|------------|----------|
| `Binary` | Generic file storage |
| `Image` | Image with auto-resize |

---


## Best Practices

1. **Use Image field for images** - Auto-resize and optimization
2. **Store as attachment** - `attachment=True` for large files
3. **Keep filename field** - Pair Binary with Char for filename
4. **Validate file types** - Security against malicious uploads
5. **Set size limits** - Prevent memory issues
6. **Generate thumbnails** - Multiple sizes for performance
7. **Use ir.attachment** - For multiple files per record
8. **Clean up orphans** - Remove unused attachments
9. **Check access rights** - Verify permissions on download
10. **Handle encoding** - Always use base64 for binary transport

## Detailed examples

Read `references/examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
