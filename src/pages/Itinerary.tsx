import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Send, MapPin, Loader2, ChevronLeft, Coffee, Sun, Moon, Utensils, Lightbulb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import EndTripButton from '@/components/EndTripButton'
import RobotFace from '@/components/RobotFace'

const ALBANIAN_CITIES = [
  'Tirana', 'Durrës', 'Vlorë', 'Sarandë', 'Berat',
  'Gjirokastër', 'Shkodër', 'Korçë', 'Pogradec', 'Elbasan',
  'Himarë', 'Ksamil', 'Theth', 'Valbona', 'Përmet',
]

const CITY_COORDS: Record<string, [number, number]> = {
  'Tirana': [41.3275, 19.8187], 'Durrës': [41.3246, 19.4565],
  'Vlorë': [40.4667, 19.4833], 'Sarandë': [39.8756, 20.0022],
  'Berat': [40.7058, 19.9522], 'Gjirokastër': [40.0758, 20.1389],
  'Shkodër': [42.0683, 19.5126], 'Korçë': [40.6186, 20.7808],
  'Pogradec': [40.9025, 20.6553], 'Elbasan': [41.1125, 20.0822],
  'Himarë': [40.1008, 19.7439], 'Ksamil': [39.7667, 20.0],
  'Theth': [42.3853, 19.8003], 'Valbona': [42.4333, 20.1],
  'Përmet': [40.2358, 20.3519],
}

interface OSMPlace {
  id: number; lat: number; lon: number
  tags: Record<string, string>
}

function getTagFilters(interests: string[]): [string, string][] {
  const map: Record<string, [string, string][]> = {
    'History & Culture': [['tourism','museum'],['historic','castle'],['tourism','archaeological_site'],['tourism','monument']],
    'Food & Dining':     [['amenity','restaurant'],['amenity','cafe']],
    'Nature & Hiking':   [['tourism','viewpoint'],['leisure','nature_reserve']],
    'Beaches':           [['natural','beach']],
    'Nightlife':         [['amenity','bar'],['amenity','nightclub'],['amenity','pub']],
    'Shopping':          [['amenity','marketplace'],['shop','mall']],
    'Photography':       [['tourism','viewpoint'],['tourism','artwork']],
    'Adventure Sports':  [['leisure','sports_centre'],['sport','climbing']],
  }
  // if no interests, return a sensible default mix
  const keys = interests.length > 0 ? interests : ['History & Culture','Food & Dining']
  const all = keys.flatMap(i => map[i] ?? [])
  return [...new Map(all.map(f => [f.join('='), f])).values()]
}

function placeInfo(tags: Record<string,string>): { emoji: string; type: string } {
  if (tags.amenity === 'restaurant') return { emoji: '🍽️', type: 'Restaurant' }
  if (tags.amenity === 'cafe')       return { emoji: '☕', type: 'Café' }
  if (tags.amenity === 'bar')        return { emoji: '🍺', type: 'Bar' }
  if (tags.amenity === 'nightclub')  return { emoji: '🎵', type: 'Nightclub' }
  if (tags.amenity === 'pub')        return { emoji: '🍻', type: 'Pub' }
  if (tags.amenity === 'marketplace')return { emoji: '🛒', type: 'Market' }
  if (tags.shop === 'mall')          return { emoji: '🏬', type: 'Mall' }
  if (tags.tourism === 'museum')     return { emoji: '🏛️', type: 'Museum' }
  if (tags.tourism === 'viewpoint')  return { emoji: '📸', type: 'Viewpoint' }
  if (tags.tourism === 'archaeological_site') return { emoji: '🏺', type: 'Archaeological Site' }
  if (tags.tourism === 'monument')   return { emoji: '🗿', type: 'Monument' }
  if (tags.tourism === 'artwork')    return { emoji: '🎨', type: 'Artwork' }
  if (tags.historic === 'castle')    return { emoji: '🏰', type: 'Castle' }
  if (tags.natural === 'beach')      return { emoji: '🏖️', type: 'Beach' }
  if (tags.leisure === 'nature_reserve') return { emoji: '🌿', type: 'Nature Reserve' }
  if (tags.leisure === 'sports_centre')  return { emoji: '⚽', type: 'Sports Centre' }
  return { emoji: '📍', type: 'Place' }
}

interface CuratedPlace { name: string; emoji: string; type: string; categories: string[] }

const CURATED: Record<string, CuratedPlace[]> = {
  'Tirana': [
    { name: 'Skanderbeg Square',        emoji: '🗿', type: 'Landmark',      categories: ['History & Culture','Photography'] },
    { name: 'National History Museum',  emoji: '🏛️', type: 'Museum',        categories: ['History & Culture'] },
    { name: "Et'hem Bey Mosque",        emoji: '🕌', type: 'Monument',      categories: ['History & Culture','Photography'] },
    { name: 'Blloku District',          emoji: '🍺', type: 'Nightlife Hub', categories: ['Nightlife','Food & Dining'] },
    { name: 'Pazari i Ri',              emoji: '🛒', type: 'Market',        categories: ['Shopping','Food & Dining'] },
    { name: 'Mount Dajti Cable Car',    emoji: '🌿', type: 'Nature',        categories: ['Nature & Hiking','Photography','Adventure Sports'] },
    { name: 'Sky Tower Restaurant',     emoji: '🍽️', type: 'Restaurant',    categories: ['Food & Dining','Photography'] },
    { name: 'Grand Park of Tirana',     emoji: '🌳', type: 'Park',          categories: ['Nature & Hiking','Photography'] },
  ],
  'Berat': [
    { name: 'Berat Castle',             emoji: '🏰', type: 'Castle',        categories: ['History & Culture','Photography'] },
    { name: 'Onufri Museum',            emoji: '🖼️', type: 'Museum',        categories: ['History & Culture'] },
    { name: 'Mangalem Quarter',         emoji: '🏘️', type: 'Old Town',      categories: ['History & Culture','Photography'] },
    { name: 'Old Bazaar',               emoji: '🛒', type: 'Market',        categories: ['Shopping','Food & Dining'] },
    { name: 'Gorica Bridge',            emoji: '🌉', type: 'Landmark',      categories: ['Photography','History & Culture'] },
    { name: 'Ethnographic Museum',      emoji: '🏺', type: 'Museum',        categories: ['History & Culture'] },
    { name: 'Osum Canyon',              emoji: '🏞️', type: 'Nature',        categories: ['Nature & Hiking','Adventure Sports','Photography'] },
  ],
  'Sarandë': [
    { name: 'Butrint Archaeological Park', emoji: '🏺', type: 'UNESCO Site', categories: ['History & Culture','Photography'] },
    { name: 'Mirror Beach',             emoji: '🏖️', type: 'Beach',         categories: ['Beaches'] },
    { name: 'Blue Eye Spring',          emoji: '💧', type: 'Nature',        categories: ['Nature & Hiking','Photography'] },
    { name: "Lëkurësi Castle",          emoji: '🏰', type: 'Castle',        categories: ['History & Culture','Photography'] },
    { name: 'Sarandë Promenade',        emoji: '🌅', type: 'Landmark',      categories: ['Photography','Food & Dining'] },
    { name: 'Ali Pasha Castle',         emoji: '🏯', type: 'Castle',        categories: ['History & Culture','Photography'] },
  ],
  'Gjirokastër': [
    { name: 'Gjirokastër Castle',       emoji: '🏰', type: 'Castle',        categories: ['History & Culture','Photography'] },
    { name: 'Old Bazaar Street',        emoji: '🛒', type: 'Market',        categories: ['Shopping','History & Culture'] },
    { name: 'Ethnographic Museum',      emoji: '🏺', type: 'Museum',        categories: ['History & Culture'] },
    { name: 'Skenduli House',           emoji: '🏘️', type: 'Heritage Site', categories: ['History & Culture','Photography'] },
    { name: 'Cold Water Cave',          emoji: '🌊', type: 'Nature',        categories: ['Nature & Hiking','Adventure Sports'] },
  ],
  'Shkodër': [
    { name: 'Rozafa Castle',            emoji: '🏰', type: 'Castle',        categories: ['History & Culture','Photography'] },
    { name: 'Shkodër Lake',             emoji: '🏞️', type: 'Nature',        categories: ['Nature & Hiking','Photography'] },
    { name: 'Marubi National Museum',   emoji: '📷', type: 'Museum',        categories: ['History & Culture','Photography'] },
    { name: 'Pedonalja Street',         emoji: '🛒', type: 'Promenade',     categories: ['Shopping','Food & Dining','Nightlife'] },
    { name: 'Mes Bridge',               emoji: '🌉', type: 'Landmark',      categories: ['History & Culture','Photography'] },
  ],
  'Vlorë': [
    { name: 'Karaburun Peninsula',      emoji: '🌿', type: 'Nature',        categories: ['Nature & Hiking','Beaches','Photography'] },
    { name: 'Independence Monument',    emoji: '🗿', type: 'Monument',      categories: ['History & Culture'] },
    { name: 'Zvernec Island Monastery', emoji: '🕍', type: 'Heritage Site', categories: ['History & Culture','Photography'] },
    { name: 'Radhimë Beach',            emoji: '🏖️', type: 'Beach',         categories: ['Beaches'] },
    { name: 'Treport Beach',            emoji: '🏖️', type: 'Beach',         categories: ['Beaches'] },
  ],
  'Korçë': [
    { name: 'National Museum of Medieval Art', emoji: '🎨', type: 'Museum', categories: ['History & Culture'] },
    { name: 'Old Bazaar',               emoji: '🛒', type: 'Market',        categories: ['Shopping','History & Culture'] },
    { name: 'Voskopoja Village',        emoji: '🌿', type: 'Village',       categories: ['History & Culture','Nature & Hiking','Photography'] },
    { name: 'Korçë Beer Festival',      emoji: '🍺', type: 'Event Venue',   categories: ['Food & Dining','Nightlife'] },
    { name: 'Drilon Springs',           emoji: '💧', type: 'Nature',        categories: ['Nature & Hiking','Photography'] },
  ],
  'Durrës': [
    { name: 'Roman Amphitheatre',       emoji: '🏺', type: 'Archaeological Site', categories: ['History & Culture','Photography'] },
    { name: 'Archaeological Museum',    emoji: '🏛️', type: 'Museum',        categories: ['History & Culture'] },
    { name: 'Durrës Beach',             emoji: '🏖️', type: 'Beach',         categories: ['Beaches'] },
    { name: 'Venetian Tower',           emoji: '🏯', type: 'Monument',      categories: ['History & Culture','Photography'] },
    { name: 'King Zog Palace',          emoji: '🏛️', type: 'Heritage Site', categories: ['History & Culture'] },
  ],
  'Ksamil': [
    { name: 'Ksamil Islands',           emoji: '🏝️', type: 'Beach',         categories: ['Beaches','Photography'] },
    { name: 'Mirror Beach Ksamil',      emoji: '🏖️', type: 'Beach',         categories: ['Beaches'] },
    { name: 'Butrint National Park',    emoji: '🌿', type: 'Nature',        categories: ['Nature & Hiking','History & Culture'] },
    { name: 'Shën Vasil Beach',         emoji: '🏖️', type: 'Beach',         categories: ['Beaches'] },
  ],
  'Himarë': [
    { name: 'Himarë Castle',            emoji: '🏰', type: 'Castle',        categories: ['History & Culture','Photography'] },
    { name: 'Livadh Beach',             emoji: '🏖️', type: 'Beach',         categories: ['Beaches'] },
    { name: 'Palasa Beach',             emoji: '🏖️', type: 'Beach',         categories: ['Beaches','Photography'] },
    { name: 'Porto Palermo Castle',     emoji: '🏯', type: 'Castle',        categories: ['History & Culture','Photography'] },
    { name: 'Potami Beach',             emoji: '🏖️', type: 'Beach',         categories: ['Beaches'] },
  ],
  'Theth': [
    { name: 'Blue Eye of Theth',        emoji: '💧', type: 'Nature',        categories: ['Nature & Hiking','Photography'] },
    { name: 'Grunas Waterfall',         emoji: '🌊', type: 'Nature',        categories: ['Nature & Hiking','Photography'] },
    { name: 'Lock-in Tower',            emoji: '🏯', type: 'Heritage Site', categories: ['History & Culture'] },
    { name: 'Peaks of the Balkans Trail', emoji: '🥾', type: 'Trail',       categories: ['Adventure Sports','Nature & Hiking'] },
    { name: 'Theth Church',             emoji: '⛪', type: 'Monument',      categories: ['History & Culture','Photography'] },
  ],
  'Valbona': [
    { name: 'Valbona Valley National Park', emoji: '🏔️', type: 'Nature',   categories: ['Nature & Hiking','Photography'] },
    { name: 'Peaks of the Balkans',     emoji: '🥾', type: 'Trail',         categories: ['Adventure Sports','Nature & Hiking'] },
    { name: 'Rrogam Village',           emoji: '🏘️', type: 'Village',       categories: ['History & Culture','Photography'] },
    { name: 'Valbona River',            emoji: '🌊', type: 'Nature',        categories: ['Nature & Hiking','Photography'] },
  ],
  'Pogradec': [
    { name: 'Lake Ohrid',               emoji: '🏞️', type: 'Nature',        categories: ['Nature & Hiking','Photography'] },
    { name: 'Drilon National Park',     emoji: '🌿', type: 'Nature',        categories: ['Nature & Hiking'] },
    { name: 'Lin Village',              emoji: '🏘️', type: 'Heritage Site', categories: ['History & Culture','Photography'] },
    { name: 'Tushemisht Village',       emoji: '🌅', type: 'Village',       categories: ['Photography','Nature & Hiking'] },
  ],
  'Elbasan': [
    { name: 'Elbasan Castle',           emoji: '🏰', type: 'Castle',        categories: ['History & Culture','Photography'] },
    { name: 'Old Bazaar',               emoji: '🛒', type: 'Market',        categories: ['Shopping','History & Culture'] },
    { name: 'Steel of the Party Museum', emoji: '🏭', type: 'Museum',       categories: ['History & Culture'] },
    { name: 'Shpella e Shenjtoreve',    emoji: '🌿', type: 'Nature',        categories: ['Nature & Hiking','History & Culture'] },
  ],
  'Përmet': [
    { name: "Bënjë Hot Springs",        emoji: '♨️', type: 'Nature',        categories: ['Nature & Hiking','Adventure Sports'] },
    { name: 'Vjosa River',              emoji: '🌊', type: 'Nature',        categories: ['Nature & Hiking','Adventure Sports','Photography'] },
    { name: 'Permet Winery',            emoji: '🍷', type: 'Winery',        categories: ['Food & Dining'] },
    { name: 'Petran Village',           emoji: '🏘️', type: 'Village',       categories: ['History & Culture','Photography'] },
  ],
}

function getCuratedPlaces(city: string, interests: string[]): CuratedPlace[] {
  const all = CURATED[city] ?? []
  if (!all.length) return []
  if (!interests.length) return all.slice(0, 8)
  const scored = all.map(p => ({ ...p, score: p.categories.filter(c => interests.includes(c)).length }))
  const matched = scored.filter(p => p.score > 0).sort((a, b) => b.score - a.score)
  // if nothing matches, fall back to the full city list
  return (matched.length > 0 ? matched : all).slice(0, 8)
}

async function fetchNearbyPlaces(city: string, interests: string[]): Promise<OSMPlace[]> {
  const coords = CITY_COORDS[city]
  if (!coords) return []
  const [lat, lon] = coords
  const filters = getTagFilters(interests)
  if (!filters.length) return []
  const nodes = filters.map(([k,v]) => `node["${k}"="${v}"](around:3000,${lat},${lon});`).join('\n  ')
  const query = `[out:json][timeout:12];(\n  ${nodes}\n);\nout body 30;`
  try {
    const res = await fetch(
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(12000) }
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.elements as OSMPlace[]).filter(p => p.tags?.name).slice(0, 20)
  } catch { return [] }
}

interface SurveyStep {
  id: string; question: string; hint?: string
  type: 'choice' | 'multi-choice' | 'text'; options?: string[]
}

const SURVEY_STEPS: SurveyStep[] = [
  { id: 'city', question: 'Which city are you visiting?', hint: 'Select a city in Albania', type: 'choice', options: ALBANIAN_CITIES },
  { id: 'duration', question: 'How long is your stay?', hint: 'Pick the closest option', type: 'choice', options: ['1 day', '2–3 days', '4–5 days', '1 week', 'More than a week'] },
  { id: 'interests', question: 'What are you most into?', hint: 'Pick as many as you like', type: 'multi-choice', options: ['History & Culture','Food & Dining','Nature & Hiking','Beaches','Nightlife','Shopping','Photography','Adventure Sports'] },
  { id: 'travel_style', question: "What's your travel style?", type: 'choice', options: ['Budget-friendly','Mid-range comfort','Luxury','Backpacker'] },
  { id: 'group', question: 'Who are you traveling with?', type: 'choice', options: ['Solo','Partner','Family with kids','Group of friends'] },
  { id: 'special', question: 'Any special requests?', hint: 'Accessibility needs, dietary preferences, etc. — or skip', type: 'text' },
]

interface ItineraryDay { day: string; theme: string; morning: string; afternoon: string; evening: string }
interface ItineraryData { title: string; summary: string; days: ItineraryDay[]; tips: string[]; must_eat: string[] }

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to generate itinerary. Please try again.'
}

function extractFirstJsonObject(text: string) {
  const normalized = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === '"') {
        inString = false
      }

      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      if (depth === 0) {
        start = index
      }
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        return normalized.slice(start, index + 1)
      }
    }
  }

  return null
}

function normalizeItineraryData(raw: unknown): ItineraryData {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<ItineraryData>
  const days = Array.isArray(value.days) ? value.days : []
  const tips = Array.isArray(value.tips) ? value.tips.filter(Boolean) : []
  const mustEat = Array.isArray(value.must_eat) ? value.must_eat.filter(Boolean) : []

  if (!days.length) {
    throw new Error('The itinerary response did not include any day plans.')
  }

  return {
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : 'Your Albania itinerary',
    summary: typeof value.summary === 'string' ? value.summary.trim() : '',
    days: days.map((day, index) => {
      const item = (day && typeof day === 'object' ? day : {}) as Partial<ItineraryDay>
      return {
        day: typeof item.day === 'string' && item.day.trim() ? item.day.trim() : `Day ${index + 1}`,
        theme: typeof item.theme === 'string' ? item.theme.trim() : 'Highlights',
        morning: typeof item.morning === 'string' ? item.morning.trim() : 'Free time',
        afternoon: typeof item.afternoon === 'string' ? item.afternoon.trim() : 'Free time',
        evening: typeof item.evening === 'string' ? item.evening.trim() : 'Free time',
      }
    }),
    tips: tips.map(tip => String(tip).trim()).filter(Boolean),
    must_eat: mustEat.map(item => String(item).trim()).filter(Boolean),
  }
}

async function generateItinerary(answers: Record<string, string | string[]>): Promise<ItineraryData> {
  const interests = Array.isArray(answers.interests) ? answers.interests.join(', ') : answers.interests
  const prompt = `Generate a complete travel itinerary. Return ONLY one valid JSON object. No markdown fences, no explanation, no extra text before or after the JSON.

Trip details:
- City: ${answers.city}
- Duration: ${answers.duration}
- Interests: ${interests}
- Travel style: ${answers.travel_style}
- Group: ${answers.group}
- Special requests: ${answers.special || 'None'}

JSON format (exactly this structure):
{
  "title": "short catchy trip title",
  "summary": "2-sentence overview of this trip",
  "days": [
    {
      "day": "Day 1",
      "theme": "theme name",
      "morning": "specific activity or place with 1 sentence detail",
      "afternoon": "specific activity or place with 1 sentence detail",
      "evening": "specific activity or place with 1 sentence detail"
    }
  ],
  "tips": ["practical tip 1", "practical tip 2", "practical tip 3"],
  "must_eat": ["local dish or restaurant 1", "local dish or restaurant 2", "local dish or restaurant 3"]
}`
  const res = await fetch('/api/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: null, prompt, max_tokens: 1600, response_mode: 'json' }),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  const data = await res.json()
  const rawAnswer = typeof data.answer === 'string' ? data.answer : ''
  const jsonBlock = extractFirstJsonObject(rawAnswer)
  if (!jsonBlock) {
    throw new Error('The itinerary service returned text instead of valid JSON.')
  }

  return normalizeItineraryData(JSON.parse(jsonBlock))
}

export default function Itinerary() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [multiSelect, setMultiSelect] = useState<string[]>([])
  const [textInput, setTextInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [done, setDone] = useState(false)
  const [itinerary, setItinerary] = useState<ItineraryData | null>(null)
  const [itineraryError, setItineraryError] = useState<string | null>(null)
  const [activeDay, setActiveDay] = useState(0)
  const [displayPlaces, setDisplayPlaces] = useState<CuratedPlace[]>([])
  const [placesLoading, setPlacesLoading] = useState(false)

  const step = SURVEY_STEPS[currentStep]
  const isLastStep = currentStep === SURVEY_STEPS.length - 1
  const progress = Math.round(((currentStep + 1) / SURVEY_STEPS.length) * 100)
  const currentAnswer = answers[step.id]

  useEffect(() => {
    const savedAnswer = answers[step.id]
    if (step.type === 'multi-choice') { setMultiSelect(Array.isArray(savedAnswer) ? savedAnswer : []); setTextInput(''); return }
    if (step.type === 'text') { setTextInput(typeof savedAnswer === 'string' && savedAnswer !== 'No special requests' ? savedAnswer : ''); setMultiSelect([]); return }
    setMultiSelect([]); setTextInput('')
  }, [answers, step.id, step.type])

  const advance = async (updated: Record<string, string | string[]>) => {
    setAnswers(updated)
    if (isLastStep) {
      setGenerating(true)
      setItineraryError(null)
      const interests = Array.isArray(updated.interests) ? updated.interests : []
      // Kick off place fetch in parallel — fall back to curated list if OSM returns nothing
      setPlacesLoading(true)
      fetchNearbyPlaces(updated.city as string, interests)
        .then(osmPlaces => {
          if (osmPlaces.length > 0) {
            setDisplayPlaces(osmPlaces.map(p => {
              const info = placeInfo(p.tags)
              return { name: p.tags.name, emoji: info.emoji, type: info.type, categories: [] }
            }))
          } else {
            setDisplayPlaces(getCuratedPlaces(updated.city as string, interests))
          }
        })
        .finally(() => setPlacesLoading(false))
      try {
        const result = await generateItinerary(updated)
        setItinerary(result); setActiveDay(0); setDone(true)
      } catch (error: unknown) {
        setItineraryError(getErrorMessage(error))
      } finally { setGenerating(false) }
    } else { setCurrentStep((prev) => prev + 1) }
  }

  const handleChoice = (value: string) => advance({ ...answers, [step.id]: value })
  const handleMultiConfirm = () => { if (multiSelect.length === 0) return; advance({ ...answers, [step.id]: multiSelect }); setMultiSelect([]) }
  const toggleMulti = (value: string) => setMultiSelect(prev => prev.includes(value) ? prev.filter(i => i !== value) : [...prev, value])
  const handleTextSubmit = () => { advance({ ...answers, [step.id]: textInput.trim() || 'No special requests' }); setTextInput('') }
  const handleBack = () => { if (currentStep > 0) setCurrentStep(prev => prev - 1); else navigate('/dashboard') }
  const handleStartOver = () => { setCurrentStep(0); setAnswers({}); setMultiSelect([]); setTextInput(''); setGenerating(false); setDone(false); setItinerary(null); setItineraryError(null); setActiveDay(0); setDisplayPlaces([]) }

  useEffect(() => {
    const TIMEOUT = 60_000; let timer: ReturnType<typeof setTimeout>
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => { sessionStorage.setItem('lockReturnPath', '/itinerary'); navigate('/') }, TIMEOUT) }
    const events = ['mousemove','mousedown','keydown','touchstart','scroll'] as const
    events.forEach(e => window.addEventListener(e, reset, { passive: true })); reset()
    return () => { clearTimeout(timer); events.forEach(e => window.removeEventListener(e, reset)) }
  }, [navigate])

  const activeItineraryDay = itinerary?.days?.[activeDay]

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#f4fbfe]">
      <header className="shrink-0 bg-[#20a7db]">
        <div className="mx-auto flex w-full items-center gap-2 px-2.5 py-1.5 max-[820px]:gap-1.5 max-[820px]:px-2 max-[820px]:py-1">
          <button onClick={() => navigate('/dashboard')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.12] text-white/80 ring-1 ring-white/[0.15] transition-colors hover:bg-white/[0.18] hover:text-white max-[820px]:h-7 max-[820px]:w-7">
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <div className="shrink-0 flex items-center justify-center"><RobotFace mini /></div>
          <div className="min-w-0">
            <h1 className="text-xs font-semibold leading-tight tracking-tight text-white max-[820px]:text-[11px]">Itinerary Planner</h1>
            <p className="text-[10px] leading-tight text-white/70 max-[820px]:text-[9px]">{done && itinerary ? itinerary.title : 'One-frame survey · Albanian cities'}</p>
          </div>
          <div className="ml-auto shrink-0 rounded-full bg-white/[0.12] px-2 py-0.5 text-[10px] font-medium text-white/80 ring-1 ring-white/[0.15] max-[820px]:px-1.5 max-[820px]:text-[9px]">
            {done ? '✓ Done' : `${currentStep + 1} / ${SURVEY_STEPS.length}`}
          </div>
          <EndTripButton />
        </div>
        <div className="h-0.5 w-full bg-white/[0.15]">
          <div className="h-full bg-white/70 transition-all duration-500" style={{ width: done ? '100%' : `${progress}%` }} />
        </div>
      </header>

      <main className="flex w-full min-h-0 flex-1 gap-2 p-2 max-[820px]:gap-1.5 max-[820px]:p-1.5">

        {generating && (
          <div className="flex flex-1 items-center justify-center">
            <div className="rounded-2xl border border-[#20a7db]/[0.12] bg-white px-8 py-6 text-center shadow-[0_20px_48px_rgba(32,167,219,0.08)] max-[820px]:px-6 max-[820px]:py-5">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#20a7db]/10 max-[820px]:h-10 max-[820px]:w-10">
                <Loader2 className="h-6 w-6 animate-spin text-[#20a7db]" />
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-900 max-[820px]:text-[13px]">Building your itinerary for {answers.city as string}…</p>
              <p className="mt-1 text-xs text-slate-500">Crafting a personalised day-by-day plan.</p>
            </div>
          </div>
        )}

        {itineraryError && !generating && (
          <div className="flex flex-1 items-center justify-center">
            <div className="rounded-2xl border border-red-200 bg-white px-8 py-6 text-center shadow-sm">
              <p className="text-sm font-semibold text-red-600">Could not generate itinerary</p>
              <p className="mt-1 text-xs text-slate-500">{itineraryError}</p>
              <Button onClick={handleStartOver} className="mt-4 h-8 bg-[#20a7db] text-xs hover:bg-[#1b96c5]">Try again</Button>
            </div>
          </div>
        )}

        {/* ── Itinerary result ── */}
        {done && !generating && itinerary && (
          <>
            {/* Left: day-by-day plan */}
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-[#20a7db]/[0.12] bg-white shadow-[0_20px_48px_rgba(32,167,219,0.07)] max-[820px]:rounded-[17px]">
              {/* Day tabs */}
              <div className="shrink-0 flex items-center gap-1 border-b border-[#20a7db]/10 bg-[#f4fbfe] px-2.5 py-1.5 overflow-x-auto max-[820px]:px-2 max-[820px]:py-1">
                {itinerary.days.map((d, i) => (
                  <button key={d.day} onClick={() => setActiveDay(i)}
                    className={cn('shrink-0 rounded-lg px-3 py-1 text-[10px] font-semibold transition-all max-[820px]:px-2 max-[820px]:text-[9px]',
                      activeDay === i ? 'bg-[#20a7db] text-white shadow-sm' : 'text-slate-500 hover:bg-[#20a7db]/10 hover:text-[#20a7db]')}>
                    {d.day}
                  </button>
                ))}
                <button onClick={() => setActiveDay(itinerary.days.length)}
                  className={cn('shrink-0 rounded-lg px-3 py-1 text-[10px] font-semibold transition-all max-[820px]:px-2 max-[820px]:text-[9px]',
                    activeDay === itinerary.days.length ? 'bg-[#20a7db] text-white shadow-sm' : 'text-slate-500 hover:bg-[#20a7db]/10 hover:text-[#20a7db]')}>
                  Tips
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-2.5 max-[820px]:p-2">
                {activeItineraryDay && activeDay < itinerary.days.length ? (
                  <div className="flex h-full flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-[#20a7db]" />
                      <span className="text-xs font-semibold text-[#20a7db] max-[820px]:text-[11px]">{activeItineraryDay.theme}</span>
                    </div>
                    {/* 3-column horizontal time slots */}
                    <div className="grid flex-1 grid-cols-3 gap-1.5">
                      {[
                        { icon: Coffee, label: 'Morning', text: activeItineraryDay.morning },
                        { icon: Sun, label: 'Afternoon', text: activeItineraryDay.afternoon },
                        { icon: Moon, label: 'Evening', text: activeItineraryDay.evening },
                      ].map(({ icon: Icon, label, text }) => (
                        <div key={label} className="flex flex-col gap-1 rounded-xl border border-[#20a7db]/10 bg-[#f8fcfe] p-2.5 max-[820px]:rounded-[14px] max-[820px]:p-2">
                          <div className="flex items-center gap-1.5">
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#20a7db]/10 max-[820px]:h-5 max-[820px]:w-5">
                              <Icon className="h-3 w-3 text-[#20a7db] max-[820px]:h-2.5 max-[820px]:w-2.5" />
                            </div>
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 max-[820px]:text-[8px]">{label}</p>
                          </div>
                          <p className="text-xs leading-4 text-slate-700 max-[820px]:text-[11px] max-[820px]:leading-4">{text}</p>
                        </div>
                      ))}
                    </div>
                    {/* Summary strip */}
                    <div className="shrink-0 rounded-xl bg-[#20a7db]/5 px-3 py-2 max-[820px]:px-2.5 max-[820px]:py-1.5">
                      <p className="text-[10px] leading-4 text-slate-600 italic max-[820px]:leading-3.5">{itinerary.summary}</p>
                    </div>
                  </div>
                ) : (
                  /* Tips tab */
                  <div className="flex h-full flex-col gap-1.5">
                    {itinerary.must_eat.length > 0 && (
                      <div>
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <Utensils className="h-3.5 w-3.5 text-[#20a7db]" />
                          <p className="text-xs font-semibold text-slate-700">Must eat</p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {itinerary.must_eat.map(item => (
                            <span key={item} className="rounded-full bg-[#20a7db]/10 px-2.5 py-1 text-[10px] font-medium text-[#20a7db] max-[820px]:px-2 max-[820px]:text-[9px]">{item}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {itinerary.tips.length > 0 && (
                      <div>
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <Lightbulb className="h-3.5 w-3.5 text-[#20a7db]" />
                          <p className="text-xs font-semibold text-slate-700">Practical tips</p>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {itinerary.tips.map((tip, i) => (
                            <div key={i} className="flex items-start gap-1.5 rounded-xl border border-[#20a7db]/10 bg-[#f8fcfe] p-2 max-[820px]:rounded-[14px] max-[820px]:p-1.5">
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#20a7db]/10 text-[9px] font-bold text-[#20a7db]">{i + 1}</span>
                              <p className="text-xs leading-4 text-slate-700 max-[820px]:text-[11px] max-[820px]:leading-4">{tip}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Right: recommended places based on interests + city */}
            <aside className="flex w-[198px] shrink-0 flex-col overflow-hidden rounded-[20px] border border-[#20a7db]/[0.12] bg-[#eff9fd] shadow-sm max-[820px]:w-[176px] max-[820px]:rounded-[17px]">
              <div className="shrink-0 border-b border-[#20a7db]/10 px-2.5 py-2 max-[820px]:px-2 max-[820px]:py-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#20a7db] max-[820px]:text-[8px] max-[820px]:tracking-[0.18em]">Recommended for You</p>
                <p className="text-xs font-semibold text-slate-800 max-[820px]:text-[11px]">Top picks in {answers.city as string}</p>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1.5 max-[820px]:space-y-1">
                {placesLoading && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-[#20a7db]" />
                    <span className="ml-2 text-[10px] text-slate-500">Finding recommendations…</span>
                  </div>
                )}
                {!placesLoading && displayPlaces.length === 0 && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-[#20a7db]" />
                  </div>
                )}
                {!placesLoading && displayPlaces.map((place, i) => {
                  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ', ' + (answers.city as string))}`
                  return (
                    <div key={i} className="flex items-center gap-1.5 rounded-xl border border-[#20a7db]/10 bg-white px-2 py-1.5">
                      <span className="text-base leading-none">{place.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10px] font-semibold text-slate-800 max-[820px]:text-[9px]">{place.name}</p>
                        <p className="text-[9px] text-slate-400">{place.type}</p>
                      </div>
                      <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#20a7db] text-white shadow-sm hover:bg-[#1b96c5] transition-colors"
                        title="View on map">
                        <MapPin className="h-3 w-3" />
                      </a>
                    </div>
                  )
                })}
              </div>

              <div className="grid shrink-0 gap-1.5 border-t border-[#20a7db]/10 p-2">
                <Button onClick={() => navigate('/dashboard')} className="h-8 bg-[#20a7db] text-xs shadow-sm shadow-[#20a7db]/25 hover:bg-[#1b96c5] max-[820px]:text-[11px]">
                  Back to dashboard
                </Button>
                <Button onClick={handleStartOver} variant="outline" className="h-8 border-[#20a7db]/[0.18] bg-white text-xs max-[820px]:text-[11px]">
                  Start over
                </Button>
              </div>
            </aside>
          </>
        )}

        {/* ── Survey ── */}
        {!generating && !done && !itineraryError && (
          <>
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-[#20a7db]/[0.12] bg-white shadow-[0_20px_48px_rgba(32,167,219,0.07)] max-[820px]:rounded-[17px]">
              <div className="shrink-0 border-b border-[#20a7db]/10 px-3 py-2 max-[820px]:px-2.5 max-[820px]:py-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[#20a7db] max-[820px]:text-[8px] max-[820px]:tracking-[0.18em]">Question {currentStep + 1} of {SURVEY_STEPS.length}</p>
                    <h2 className="mt-0.5 text-sm font-semibold tracking-tight text-slate-900 max-[820px]:text-[13px]">{step.question}</h2>
                    {step.hint && <p className="mt-0.5 text-xs text-slate-500 max-[820px]:text-[11px]">{step.hint}</p>}
                  </div>
                  <span className="shrink-0 rounded-lg border border-[#20a7db]/[0.12] bg-[#f4fbfe] px-2 py-1 text-[10px] font-semibold text-slate-600 max-[820px]:text-[9px]">{progress}%</span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2.5 max-[820px]:p-2">
                {step.type === 'choice' && step.id === 'city' && (
                  <div className="grid grid-cols-3 gap-1.5">
                    {step.options!.map(option => (
                      <button key={option} onClick={() => handleChoice(option)}
                        className={cn('rounded-xl border px-2 py-2 text-left text-xs font-medium transition-all duration-150 max-[820px]:rounded-[14px] max-[820px]:px-1.5 max-[820px]:py-1.5 max-[820px]:text-[11px]',
                          currentAnswer === option ? 'border-[#20a7db] bg-[#20a7db]/10 text-[#1578a0] shadow-sm' : 'border-[#20a7db]/[0.12] bg-white text-slate-700 hover:border-[#20a7db]/30 hover:bg-[#20a7db]/5')}>
                        {option}
                      </button>
                    ))}
                  </div>
                )}
                {step.type === 'choice' && step.id !== 'city' && (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {step.options!.map(option => (
                      <button key={option} onClick={() => handleChoice(option)}
                        className={cn('rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition-all duration-150 max-[820px]:rounded-[14px] max-[820px]:px-2.5 max-[820px]:py-2 max-[820px]:text-[11px]',
                          currentAnswer === option ? 'border-[#20a7db] bg-[#20a7db]/10 text-[#1578a0] shadow-sm' : 'border-[#20a7db]/[0.12] bg-white text-slate-700 hover:border-[#20a7db]/30 hover:bg-[#20a7db]/5')}>
                        {option}
                      </button>
                    ))}
                  </div>
                )}
                {step.type === 'multi-choice' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-4">
                      {step.options!.map(option => (
                        <button key={option} onClick={() => toggleMulti(option)}
                          className={cn('rounded-xl border px-3 py-2 text-left text-xs font-medium transition-all duration-150 max-[820px]:rounded-[14px] max-[820px]:px-2.5 max-[820px]:py-1.5 max-[820px]:text-[11px]',
                            multiSelect.includes(option) ? 'border-[#20a7db] bg-[#20a7db] text-white shadow-sm shadow-[#20a7db]/25' : 'border-[#20a7db]/[0.12] bg-white text-slate-700 hover:border-[#20a7db]/30 hover:bg-[#20a7db]/5')}>
                          {option}
                        </button>
                      ))}
                    </div>
                    <Button onClick={handleMultiConfirm} disabled={multiSelect.length === 0}
                      className="h-9 w-full bg-[#20a7db] text-xs shadow-sm shadow-[#20a7db]/25 hover:bg-[#1b96c5] disabled:opacity-40 max-[820px]:h-8 max-[820px]:text-[11px]">
                      {multiSelect.length === 0 ? 'Select at least one' : `Continue — ${multiSelect.length} selected`}
                    </Button>
                  </div>
                )}
                {step.type === 'text' && (
                  <div className="space-y-2">
                    <div className="flex gap-1.5">
                      <input type="text" value={textInput} onChange={e => setTextInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleTextSubmit()}
                        placeholder="e.g. vegetarian meals, wheelchair access…"
                        className="h-9 flex-1 rounded-xl border border-[#20a7db]/[0.15] bg-[#f4fbfe] px-3 text-xs text-slate-700 placeholder:text-slate-400 transition-colors focus:border-[#20a7db] focus:outline-none focus:ring-2 focus:ring-[#20a7db]/20 max-[820px]:h-8 max-[820px]:text-[11px]" />
                      <button onClick={handleTextSubmit}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#20a7db] text-white shadow-sm shadow-[#20a7db]/25 transition-colors hover:bg-[#1b96c5] max-[820px]:h-8 max-[820px]:w-8">
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button onClick={handleTextSubmit} className="text-xs font-medium text-slate-500 transition-colors hover:text-[#20a7db] max-[820px]:text-[11px]">
                      Skip this question →
                    </button>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center justify-between border-t border-[#20a7db]/10 bg-[#fbfeff] px-3 py-2 max-[820px]:px-2.5 max-[820px]:py-1.5">
                {currentStep > 0 ? (
                  <button onClick={handleBack} className="flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-900 max-[820px]:text-[11px]">
                    <ChevronLeft className="h-3.5 w-3.5" />Back
                  </button>
                ) : <span />}
                <p className="text-[10px] text-slate-400 max-[820px]:text-[9px]">
                  {step.type === 'multi-choice' ? (multiSelect.length === 0 ? 'Choose one or more interests.' : `${multiSelect.length} selected`) :
                   step.type === 'text' ? 'Add details or skip.' :
                   currentAnswer ? 'Tap another option to change it.' : 'Choose one option to continue.'}
                </p>
              </div>
            </section>

            {/* Snapshot sidebar */}
            <aside className="flex w-[160px] shrink-0 flex-col rounded-[20px] border border-[#20a7db]/[0.12] bg-[#eff9fd] p-2.5 shadow-sm max-[820px]:w-[148px] max-[820px]:rounded-[17px] max-[820px]:p-2">
              <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#20a7db] max-[820px]:text-[8px] max-[820px]:tracking-[0.18em]">Trip snapshot</p>
              <h3 className="mt-1 shrink-0 text-sm font-semibold tracking-tight text-slate-900 max-[820px]:text-[13px]">Answers so far</h3>
              <div className="mt-2 grid gap-1.5 max-[820px]:mt-1.5 max-[820px]:gap-1">
                {[
                  { label: 'City', value: typeof answers.city === 'string' ? answers.city : 'Choose a city' },
                  { label: 'Duration', value: typeof answers.duration === 'string' ? answers.duration : 'Not selected yet' },
                  { label: 'Interests', value: Array.isArray(answers.interests) && answers.interests.length > 0 ? `${answers.interests.length} selected` : 'Not selected yet' },
                  { label: 'Style', value: typeof answers.travel_style === 'string' ? answers.travel_style : 'Not selected yet' },
                  { label: 'Group', value: typeof answers.group === 'string' ? answers.group : 'Not selected yet' },
                  { label: 'Notes', value: typeof answers.special === 'string' ? answers.special : 'Optional' },
                ].map(item => (
                  <div key={item.label} className="rounded-xl border border-[#20a7db]/10 bg-white/80 px-2 py-1.5 max-[820px]:px-1.5 max-[820px]:py-1">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 max-[820px]:text-[8px]">{item.label}</p>
                    <p className="truncate text-xs font-medium text-slate-800 max-[820px]:text-[11px]">{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-auto pt-2.5 max-[820px]:pt-2">
                <Button onClick={() => navigate('/dashboard')} className="h-9 w-full bg-[#20a7db] text-xs shadow-sm shadow-[#20a7db]/25 hover:bg-[#1b96c5] max-[820px]:h-8 max-[820px]:text-[11px]">
                  Back to dashboard
                </Button>
              </div>
            </aside>
          </>
        )}
      </main>
    </div>
  )
}
