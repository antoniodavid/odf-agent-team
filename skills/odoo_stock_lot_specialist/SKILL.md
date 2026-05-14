# Odoo Stock Lot/Serial Specialist

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

## Instructions

### When This Skill Is Active

1. **Product Configuration (product.template/product.product):**
   - Verify `tracking` field: `none` | `lot` | `serial`
   - For `lot`: single lot number assigned to batch of items
   - For `serial`: every unit MUST have unique serial number (quantity=1)
   - Check if `expiration_dates` group is enabled in Inventory Settings

2. **Lot/Serial Assignment (stock.move.line):**
   - **Receipts**: assign lots/serials BEFORE validating transfer
   - Methods: manual entry, barcode scan, paste list, or auto-generate sequential
   - **Deliveries**: Odoo auto-reserves based on removal strategy
   - Users can modify reserved lots via detailed operations icon

3. **FEFO/FIFO Removal Strategies:**
   - Configured on `product.category` OR `stock.location`
   - **FIFO**: reserves oldest received stock first (by receipt datetime)
   - **FEFO**: reserves by **Removal Date** (NOT expiration date) — earliest removal date first
   - **LIFO**: reserves newest stock first
   - **Closest location**: nearest physical location
   - **Least packages**: minimizes number of packages to pick

4. **Expiration Dates (stock.lot fields):**
   - `expiration_date`: product strictly expires (unsafe after)
   - `best_before_date`: quality begins degrading
   - `removal_date`: when to pull from shelves (FEFO uses this)
   - `alert_date`: automated activity/alert triggered
   - Dates auto-calculated from product-level settings on receipt

5. **Traceability:**
   - Core model: `stock.lot` (v16+), was `stock.production.lot` in older versions
   - Traceability report shows upstream/downstream genealogy
   - Tracks: vendor receipt → manufacturing component → customer delivery
   - Access from any lot/serial record

6. **Barcode Integration:**
   - Barcode app supports scanning lots/serials during operations
   - GS1 barcode nomenclature supported
   - RFID integration available for v18+

7. **Engram Persistence:**
   - After significant findings: `mem_save(title, type="decision"|"pattern")`
   - Save lot management decisions with topic_key: `odf/agents/odoo_stock_lot_specialist/{artifact}`

## Rules

- NEVER validate transfers without lot/serial assignment if product tracking requires it
- ALWAYS configure removal strategy at category OR location level (not both inconsistently)
- NEVER deliver lots past `expiration_date` (block at validation)
- ALWAYS enforce serial uniqueness at database level (constrain quantity=1)
- For FEFO: `removal_date` drives reservation, NOT `expiration_date`
- Use `stock.quant` for lot/location availability checks
- Handle `stock.move.line` correctly for lot/serial assignments
- Follow OCA style: `_()` for user-facing strings, proper field naming
- For v16+: Use `Command` class for x2many lot operations
- NEVER modify core Odoo files — only custom modules

## Examples

### Example 1: Validate Lot on Delivery (Block Expired)

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

### Example 2: FEFO Lot Selection (Prioritize by Removal Date)

```python
def get_fefo_lots(self, product_id, location_id, quantity_needed):
    """Return lots ordered by removal_date ASC (FEFO strategy)."""
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
        
        serial_prefix = self.product_id.serial_prefix or 'SN'
        start_num = self.product_id.last_serial_number or 1
        
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

## ODF Integration

Supports **DESIGN** and **IMPLEMENT** phases:

- **DESIGN**: Advises on lot/serial data model, removal strategies, traceability architecture, barcode integration
- **IMPLEMENT**: Writes models, views, validation logic, reports for lot/serial management

Does NOT support ASSESS (use `odoo_functional_consultant` for standard vs custom).

## Version-Specific Notes

- **v16**: Basic lot/serial tracking, expiration dates, removal strategies under generic menu
- **v17**: Added specific guides for "Assign serial numbers", "Reassign lot/serial numbers", removal strategies broken into dedicated pages (FIFO, LIFO, FEFO, Closest location, Least packages)
- **v18**: New "Valuation by lots/serial numbers", expanded "Barcodes for lot and serial numbers", "Manufacture with lots and serial numbers" guides
- **v18+**: RFID integration available in Barcode app

## Documentation Sources

Based on official Odoo documentation (NotebookLM-validated):
- Inventory — Odoo 16.0/17.0/18.0/19.0 documentation
- Barcode — Odoo 16.0/17.0/18.0/19.0 documentation  
- Manufacturing — Odoo 16.0/17.0/18.0/19.0 documentation
- NotebookLM Source: `2c4e0de7-3424-4ddb-bb7b-1e7cc3164ee3` (Odoo Inventory — Routes, Push/Pull Rules, Warehouse)
