/**
 * Vercel Serverless Function: /api/config
 * Expone las variables públicas de entorno configuradas en el panel de Vercel.
 * NUNCA exponer variables secretas como SUPABASE_SERVICE_ROLE_KEY.
 */
export default function handler(req, res) {
    // Configurar encabezados de seguridad y CORS para el mismo origen
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    return res.status(200).json({
        SUPABASE_URL: supabaseUrl,
        SUPABASE_ANON_KEY: supabaseAnonKey
    });
}

