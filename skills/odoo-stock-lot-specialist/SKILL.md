---
name: odoo-stock-lot-specialist
description: "Odoo stock lot and serial specialist for traceability, removal strategies, expiration, and barcode flows. Trigger: stock, lot, serial, FEFO, traceability, picking, or inventory work in DESIGN or IMPLEMENT."
license: MIT
metadata:
  author: adruban
  version: "1.2"
---

# Odoo Stock Lot/Serial Specialist

## Activation Contract

Use only for DESIGN or IMPLEMENT work involving stock lots, serial numbers,
traceability, removal strategies, expiration, or barcode flows. Require the
target Odoo version, local source, and approved human `EXP-XX` expectations
before relying on a field, model, UI behavior, or business rule. Version-
specific claims are `verify-local` unless proven.

## Description

Expert in Odoo inventory lot and serial number tracking, traceability, and FEFO/FIFO removal strategies. Based on official Odoo documentation v16-v19.

## Trigger

Activate when working with:
- Inventory/stock management (`stock`, `stock_lot`, `stock_move_line`)
- Lot numbers (`lot`, `lote`, `batch`)
- Serial numbers (`serial`, `serie`, `imei`, `unique`)
- Traceability (`traceability`, `trazabilidad`, `tracking`)
- FEFO/FIFO removal (`removal strategy`, `fefo`, `fifo`, `lifo`)
- Expiration dates (`expiration`, `expiry`, `vencimiento`, `best before`)
- Stock picking operations (`picking`, `receipt`, `delivery`, `transfer`)
- Barcode scanning for lots/serials (`barcode`, `scan`)

## Execution Steps

### When This Skill Is Active

1. **Product Configuration (product.template/product.product):**
   - Verify `tracking` field: `none` | `lot` | `serial`
    - For `lot`: verify the target version's lot assignment behavior
    - For `serial`: verify the target version and approved policy for quantity and uniqueness
    - Check whether expiration settings exist and apply in the target version

2. **Lot/Serial Assignment (stock.move.line):**
    - **Receipts**: assign lots/serials before validation only when required by target metadata and approved policy
   - Methods: manual entry, barcode scan, paste list, or auto-generate sequential
    - **Deliveries**: verify reservation behavior and configured removal strategy locally
   - Users can modify reserved lots via detailed operations icon

3. **FEFO/FIFO Removal Strategies:**
    - Verify the target version's configuration scope and precedence
    - Verify FIFO, FEFO, LIFO, location, or package ordering locally before relying on it

4. **Expiration Dates (stock.lot fields):**
    - Expiration field names and enforcement semantics are version-gated; verify local metadata and business policy
    - Do not infer that an expiration date automatically blocks every delivery

5. **Traceability:**
    - Lot model name is version-gated; verify it in the target local source before coding
    - Verify the target version's traceability report and genealogy path

6. **Barcode Integration:**
    - Verify barcode lot/serial scanning and GS1 support for the target version and installed modules
    - RFID integration is version/module-gated; verify locally before claiming support

7. **Engram Persistence:**
   - After significant findings: `mem_save(title, type="decision"|"pattern")`
   - Save lot management decisions with topic_key: `odf/agents/odoo_stock_lot_specialist/{artifact}`

## Hard Rules

- Do not impose lot/serial assignment, expiration, uniqueness, or reservation rules universally; require target-version evidence and approved EXP-XX policy first.
- If a requested rule changes reservation or validation semantics, require an approved EXP-XX and a regression test before implementation.
- Treat model, field, menu, strategy, and `Command` usage as version-gated until verified against local source.
- Use `stock.quant` for lot/location availability checks
- Handle `stock.move.line` correctly for lot/serial assignments
- Follow OCA style: `_()` for user-facing strings, proper field naming
- Use `Command` for x2many lot operations only when supported by the target version.
- NEVER modify core Odoo files — only custom modules

## Examples

### Example 1: Conditional Expired-Lot Validation

```python
from odoo import api, fields, models, _
from odoo.exceptions import ValidationError

class StockPicking(models.Model):
    _inherit = "stock.picking"
    
    def button_validate(self):
        for move_line in self.move_line_ids:
            if move_line.product_id.tracking == 'lot':
                if move_line.lot_id and move_line.lot_id.expiration_date:
                    if move_line.lot_id.expiration_date < fields.Date.today():
                        raise ValidationError(_(
                            "Cannot deliver expired lot %s (expired: %s)"
                        ) % (move_line.lot_id.name, move_line.lot_id.expiration_date))
        return super().button_validate()
```

### Example 2: Version-Gated FEFO Lot Selection

```python
def get_fefo_lots(self, product_id, location_id, quantity_needed):
    """Illustrative ordering; verify the configured target-version date field."""
    lots = self.env['stock.lot'].search([
        ('product_id', '=', product_id),
        ('quant_ids.location_id', '=', location_id),
        ('quant_ids.quantity', '>', 0),
    ], order='removal_date ASC, expiration_date ASC')
    
    selected = []
    remaining = quantity_needed
    for lot in lots:
        if remaining <= 0:
            break
        lot_qty = sum(lot.quant_ids.filtered(
            lambda q: q.location_id.id == location_id
        ).mapped('quantity'))
        if lot_qty > 0:
            selected.append((lot.id, min(remaining, lot_qty)))
            remaining -= lot_qty
    
    return selected
```

### Example 3: Auto-Generate Serial Numbers on Receipt

```python
class StockMove(models.Model):
    _inherit = "stock.move"
    
    def _generate_serial_numbers(self):
        """Auto-generate sequential serial numbers for tracked products."""
        self.ensure_one()
        if self.product_id.tracking != 'serial':
            return
        
        # These are custom fields in this example, not universal Odoo fields.
        # Verify or replace them against the target module and version.
        serial_prefix = self.product_id.x_serial_prefix or 'SN'
        start_num = self.product_id.x_last_serial_number or 1
        
        for i in range(int(self.product_uom_qty)):
            serial_name = f"{serial_prefix}{start_num + i:06d}"
            self.move_line_ids.create({
                'move_id': self.id,
                'product_id': self.product_id.id,
                'lot_name': serial_name,
                'quantity': 1,
                'location_id': self.location_id.id,
                'location_dest_id': self.location_dest_id.id,
            })
```

## Decision Gates

- If a model, field, menu, or strategy differs by version, stop and mark it
  `version-gated/verify-local` rather than asserting a universal API.
- If no approved EXP-XX or target Odoo version is available, block implementation and return `version-gated/verify-local`.

## ODF Integration

Supports **DESIGN** and **IMPLEMENT** phases:

- **DESIGN**: Advises on lot/serial data model, removal strategies, traceability architecture, barcode integration
- **IMPLEMENT**: Writes models, views, validation logic, reports for lot/serial management

Does NOT support ASSESS (use `odoo_functional_consultant` for standard vs custom).

## Output Contract

Return findings, verified model/field names, version, assumptions, EXP-XX
traceability, and test implications. Mark unverified claims explicitly.

## References

- `/home/adruban/.config/opencode/skills/_shared/result-contract.md` — ODF Result envelope
- `/home/adruban/.config/opencode/skills/_shared/odoo-sources.md` — Local source paths

## Version-Specific Notes

- **v16-v19**: Verify feature availability, field names, menus, and strategy semantics against the target local source and official version documentation

## Documentation Sources

Based on official Odoo documentation (NotebookLM-validated):
- Inventory — Odoo 16.0/17.0/18.0/19.0 documentation
- Barcode — Odoo 16.0/17.0/18.0/19.0 documentation  
- Manufacturing — Odoo 16.0/17.0/18.0/19.0 documentation
- NotebookLM Source: `2c4e0de7-3424-4ddb-bb7b-1e7cc3164ee3` (Odoo Inventory — Routes, Push/Pull Rules, Warehouse)
