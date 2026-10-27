# Dashboard and KPI Patterns

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  DASHBOARD & KPI PATTERNS                                                    ║
║  Analytics views, KPI displays, and business intelligence                    ║
║  Use for data visualization and executive dashboards                         ║
╚══════════════════════════════════════════════════════════════════════════════╝
```


## Best Practices

1. **Use database views** - _auto=False for aggregated models
2. **Index key columns** - Add indexes to frequently filtered fields
3. **Pre-aggregate** - Calculate totals in SQL, not Python
4. **Cache expensive** - Use Redis/Memcached for heavy queries
5. **Limit date ranges** - Default to current month/quarter
6. **Add search filters** - Make it easy to drill down
7. **Use measures wisely** - Choose meaningful KPIs
8. **Refresh async** - Use background jobs for heavy data
9. **Mobile friendly** - Design for responsive display
10. **Test performance** - Verify with production data volumes

## Detailed examples

Read `dashboard-kpi-patterns-examples.md` for the full code behind every pattern above. Load it only when you need the implementation.
