import { templateInfo } from '../../../lib/templates';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { jsonNoStore } from '../../../lib/server/http';

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('templates')
        .select('id, name_en, name_th, description, tag, category, accent_color, preview_asset, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (!error && data && data.length > 0) {
        return jsonNoStore({
          source: 'supabase',
          templates: data.map((t) => ({
            id: t.id,
            name: t.name_en,
            nameTH: t.name_th,
            description: t.description,
            tag: t.tag,
            category: t.category,
            color: t.accent_color,
            previewAsset: t.preview_asset,
          })),
        });
      }
    }
  } catch {
    // Fall back to static template definitions when Supabase is not yet migrated.
  }

  return jsonNoStore({
    source: 'local',
    templates: templateInfo,
  });
}
