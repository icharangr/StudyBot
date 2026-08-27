export const KICK_QUOTES = [
  'Stand up. Open the book. The next 25 minutes are not optional.',
  'Your exam date is fixed. Your excuses are not. Start the block now.',
  'Nobody is coming to rescue this syllabus. Sit down and finish the next page.',
  'You already know what to do. Stop shopping for a feeling and start the timer.',
  'GATE and UPSC do not care that you are tired. Open the notes.',
  'If you wait until you feel ready, you will lose the year. Begin in the next 10 seconds.',
  'External truth: the people who pass started before they wanted to. Start now.',
  'Put the phone face down. The mission in front of you is the only thing that counts.',
  'You are not behind because of luck. You are behind until this block is done. Go.',
  'A finished PYQ set beats a motivated morning. Do the work.',
  'The clock is already running on 2027. Match it. Start this block.',
  'Your future rank is being decided by what you do in the next hour. Sit.',
  'Stop refreshing your life. Complete the current mission, then the next one.',
  'Discipline is arriving on time for a war nobody else can fight for you.',
  'You said you wanted a different life. Then stop negotiating with this chair.',
  'The syllabus does not shrink while you rest. Attack the next topic.',
  'Make it so obvious you studied that tonight cannot argue with you.',
  'If it takes 20 minutes to start, you already lost the block. Open it now.',
  'Comfort is the competitor. Beat it by finishing the next hard page.',
  'No pep talk will mark the paper. Your hand on the pen will. Begin.',
  'You can feel resistance and still start. Starting is the kick.',
  'Treat this hour like an invigilator is watching. No sliding away.',
  'The version of you who clears the cutoff is the one who starts ugly and stays.',
  'Do not plan the whole year again. Finish the block that is already on the list.',
  'Outside pressure: every day you skip, someone else logs a session. Log yours.',
];

export function pickKickQuote(previous = '') {
  const pool = KICK_QUOTES.filter(q => q !== previous);
  return (pool.length ? pool : KICK_QUOTES)[Math.floor(Math.random() * (pool.length || KICK_QUOTES.length))];
}

export async function fetchKickQuote(previous = '', supabase = null) {
  try {
    const res = await fetch(`/api/quote?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data?.quote && data.quote !== previous) return data.quote;
    }
  } catch {
    /* local / missing API */
  }

  try {
    if (supabase) {
      const { data } = await supabase.from('quotes').select('quote').eq('active', true);
      const lines = (data || []).map(row => row.quote).filter(Boolean);
      if (lines.length) {
        const pool = lines.filter(q => q !== previous);
        return (pool.length ? pool : lines)[Math.floor(Math.random() * (pool.length || lines.length))];
      }
    }
  } catch {
    /* quotes table optional */
  }

  return pickKickQuote(previous);
}
