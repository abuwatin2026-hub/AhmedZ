const fs = require('fs');

let sql = fs.readFileSync('tmp_local_public.sql', 'utf8');

function extractFunction(matchString) {
  const lines = sql.split('\n');
  const start = lines.findIndex(l => l.includes(matchString));
  if (start === -1) throw new Error('Not found: ' + matchString);
  const end = lines.findIndex((l, i) => i > start && l.startsWith('$$;'));
  return lines.slice(start, end + 1).join('\n');
}

try {
  let reserveSql = extractFunction('CREATE OR REPLACE FUNCTION "public"."reserve_stock_for_order"("p_items" "jsonb", "p_order_id" "uuid" DEFAULT NULL::"uuid", "p_warehouse_id" "uuid" DEFAULT NULL::"uuid")');
  let deductSql = extractFunction('CREATE OR REPLACE FUNCTION "public"."deduct_stock_on_delivery_v2"("p_order_id" "uuid", "p_items" "jsonb", "p_warehouse_id" "uuid")');

  // Inject v_item_wh declaration safely
  reserveSql = reserveSql.replace('v_item jsonb;', 'v_item jsonb;\n  v_item_wh uuid;');
  reserveSql = reserveSql.replace(
    'v_requested := coalesce(nullif(v_item->>\'quantity\',\'\')::numeric, nullif(v_item->>\'qty\',\'\')::numeric, 0);',
    'v_requested := coalesce(nullif(v_item->>\'quantity\',\'\')::numeric, nullif(v_item->>\'qty\',\'\')::numeric, 0);\n    v_item_wh := coalesce(nullif(v_item->>\'warehouseId\', \'\')::uuid, p_warehouse_id);'
  );
  reserveSql = reserveSql.replace(/p_warehouse_id/g, 'v_item_wh');
  reserveSql = reserveSql.replace('"v_item_wh" "uuid" DEFAULT', '"p_warehouse_id" "uuid" DEFAULT');
  reserveSql = reserveSql.replace('if p_order_id is null or v_item_wh is null then', 'if p_order_id is null or p_warehouse_id is null then');

  deductSql = deductSql.replace('v_item jsonb;', 'v_item jsonb;\n  v_item_wh uuid;');
  deductSql = deductSql.replace(
    'v_requested := coalesce(nullif(v_item->>\'quantity\',\'\')::numeric, nullif(v_item->>\'qty\',\'\')::numeric, 0);',
    'v_requested := coalesce(nullif(v_item->>\'quantity\',\'\')::numeric, nullif(v_item->>\'qty\',\'\')::numeric, 0);\n    v_item_wh := coalesce(nullif(v_item->>\'warehouseId\', \'\')::uuid, p_warehouse_id);'
  );
  deductSql = deductSql.replace(/p_warehouse_id/g, 'v_item_wh');
  deductSql = deductSql.replace('("p_order_id" "uuid", "p_items" "jsonb", "v_item_wh" "uuid")', '("p_order_id" "uuid", "p_items" "jsonb", "p_warehouse_id" "uuid")');
  deductSql = deductSql.replace('if p_order_id is null or v_item_wh is null then', 'if p_order_id is null or p_warehouse_id is null then');

  fs.writeFileSync('apply_multi_wh.sql', reserveSql + '\n\n' + deductSql);
  console.log('Successfully wrote apply_multi_wh.sql');
} catch (e) {
  console.error(e);
}
