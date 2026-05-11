const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://pmhivhtaoydfolseelyc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec'
);

async function countRest() {
  await supabase.auth.signInWithPassword({ email: 'owner@azta.com', password: 'AhmedZ#123456' });

  const { data, error } = await supabase
    .from('orders')
    .select('id');
    
  console.log('Total orders in REST API:', data ? data.length : error);
}

countRest();
