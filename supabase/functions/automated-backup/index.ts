import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

console.log('Automated Backup Function Started...');

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const cronSecret = Deno.env.get('BACKUP_CRON_SECRET') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase Environment Variables');
    }
    if (!token || (token !== supabaseKey && token !== cronSecret)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const health = await supabase.rpc('admin_backup_health_report');
    if (health.error) throw new Error(`backup health check failed: ${health.error.message}`);
    const failedChecks = Array.isArray((health.data as any)?.checks)
      ? (health.data as any).checks.filter((c: any) => !c?.ok)
      : [];
    if (failedChecks.length > 0) throw new Error(`health checks failed: ${failedChecks.map((x: any) => x.key).join(', ')}`);

    const { data: tables, error: schemaError } = await supabase.rpc('admin_get_all_tables');
    if (schemaError || !tables) throw new Error(schemaError?.message || 'Failed to fetch schema');

    const backupData: Record<string, any[]> = {};
    const rowCounts: Record<string, number> = {};

    for (const table of tables) {
      const chunkSize = 2000;
      let offset = 0;
      let tableData: any[] = [];
      let hasMore = true;

      while (hasMore) {
        const { data: chunk, error: dataError } = await supabase.rpc('admin_export_table_data', {
          p_table: table,
          p_offset: offset,
          p_limit: chunkSize
        });

        if (dataError) throw new Error(`Export error on ${table}: ${dataError.message}`);

        const chunkArray = Array.isArray(chunk) ? chunk : [];
        tableData = tableData.concat(chunkArray);

        if (chunkArray.length < chunkSize) {
          hasMore = false;
        } else {
          offset += chunkSize;
        }
      }

      backupData[table] = tableData;
      rowCounts[table] = tableData.length;
    }

    const schemaMigrations = Array.isArray((backupData as any).schema_migrations) ? (backupData as any).schema_migrations : [];
    const migrationStrings = schemaMigrations
      .map((x: any) => String(x?.version || x?.name || x?.id || '').trim())
      .filter(Boolean)
      .sort();
    const finalObject = {
      version: '2.0',
      timestamp: new Date().toISOString(),
      source: 'Automated Edge Function Backup',
      manifest: {
        format_version: '2.0',
        schema_migration_count: migrationStrings.length,
        schema_migration_latest: migrationStrings.length ? migrationStrings[migrationStrings.length - 1] : null,
        table_count: Object.keys(backupData).length,
        row_counts: rowCounts,
      },
      data: backupData
    };

    const jsonString = JSON.stringify(finalObject);
    const filename = `automated-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const uint8Array = new TextEncoder().encode(jsonString);

    const { error: uploadError } = await supabase.storage
      .from('automated_backups')
      .upload(filename, uint8Array, {
        contentType: 'application/json',
        upsert: false
      });

    if (uploadError) {
      console.error('Storage Upload Error:', uploadError);
      throw new Error(`Failed to upload to storage: ${uploadError.message}`);
    }

    return new Response(
      JSON.stringify({ message: `Backup successful: ${filename}` }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Backup failed:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
