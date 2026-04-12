export type MalaysiaPopularLocation = {
  state: string;
  name: string;
};

// Curated for property/search UX.
// This is intentionally a popular city/area list, not a strict administrative district dataset.
export const MALAYSIA_POPULAR_LOCATIONS: MalaysiaPopularLocation[] = [
  { state: "Johor", name: "Johor Bahru" },
  { state: "Johor", name: "Iskandar Puteri" },
  { state: "Johor", name: "Skudai" },
  { state: "Johor", name: "Tebrau" },
  { state: "Johor", name: "Pasir Gudang" },
  { state: "Johor", name: "Ulu Tiram" },
  { state: "Johor", name: "Kulai" },
  { state: "Johor", name: "Batu Pahat" },
  { state: "Johor", name: "Muar" },
  { state: "Johor", name: "Kluang" },
  { state: "Johor", name: "Segamat" },
  { state: "Johor", name: "Pontian" },

  { state: "Kedah", name: "Alor Setar" },
  { state: "Kedah", name: "Sungai Petani" },
  { state: "Kedah", name: "Kulim" },
  { state: "Kedah", name: "Langkawi" },
  { state: "Kedah", name: "Jitra" },
  { state: "Kedah", name: "Gurun" },
  { state: "Kedah", name: "Baling" },

  { state: "Kelantan", name: "Kota Bharu" },
  { state: "Kelantan", name: "Wakaf Bharu" },
  { state: "Kelantan", name: "Kubang Kerian" },
  { state: "Kelantan", name: "Pasir Mas" },
  { state: "Kelantan", name: "Tanah Merah" },
  { state: "Kelantan", name: "Kuala Krai" },
  { state: "Kelantan", name: "Gua Musang" },

  { state: "Kuala Lumpur", name: "Bangsar" },
  { state: "Kuala Lumpur", name: "Mont Kiara" },
  { state: "Kuala Lumpur", name: "Cheras" },
  { state: "Kuala Lumpur", name: "Setapak" },
  { state: "Kuala Lumpur", name: "Bukit Jalil" },
  { state: "Kuala Lumpur", name: "Sri Petaling" },
  { state: "Kuala Lumpur", name: "Kepong" },
  { state: "Kuala Lumpur", name: "Ampang Hilir" },
  { state: "Kuala Lumpur", name: "Taman Tun Dr Ismail" },
  { state: "Kuala Lumpur", name: "Desa ParkCity" },

  { state: "Labuan", name: "Labuan" },
  { state: "Labuan", name: "Victoria" },

  { state: "Melaka", name: "Melaka City" },
  { state: "Melaka", name: "Ayer Keroh" },
  { state: "Melaka", name: "Batu Berendam" },
  { state: "Melaka", name: "Alor Gajah" },
  { state: "Melaka", name: "Masjid Tanah" },
  { state: "Melaka", name: "Jasin" },

  { state: "Negeri Sembilan", name: "Seremban" },
  { state: "Negeri Sembilan", name: "Nilai" },
  { state: "Negeri Sembilan", name: "Port Dickson" },
  { state: "Negeri Sembilan", name: "Senawang" },
  { state: "Negeri Sembilan", name: "Bahau" },
  { state: "Negeri Sembilan", name: "Tampin" },
  { state: "Negeri Sembilan", name: "Rembau" },

  { state: "Pahang", name: "Kuantan" },
  { state: "Pahang", name: "Temerloh" },
  { state: "Pahang", name: "Mentakab" },
  { state: "Pahang", name: "Bentong" },
  { state: "Pahang", name: "Raub" },
  { state: "Pahang", name: "Pekan" },
  { state: "Pahang", name: "Cameron Highlands" },

  { state: "Perak", name: "Ipoh" },
  { state: "Perak", name: "Taiping" },
  { state: "Perak", name: "Manjung" },
  { state: "Perak", name: "Sitiawan" },
  { state: "Perak", name: "Teluk Intan" },
  { state: "Perak", name: "Kampar" },
  { state: "Perak", name: "Lumut" },
  { state: "Perak", name: "Seri Iskandar" },

  { state: "Perlis", name: "Kangar" },
  { state: "Perlis", name: "Arau" },
  { state: "Perlis", name: "Kuala Perlis" },
  { state: "Perlis", name: "Padang Besar" },

  { state: "Pulau Pinang", name: "George Town" },
  { state: "Pulau Pinang", name: "Bayan Lepas" },
  { state: "Pulau Pinang", name: "Tanjung Tokong" },
  { state: "Pulau Pinang", name: "Air Itam" },
  { state: "Pulau Pinang", name: "Butterworth" },
  { state: "Pulau Pinang", name: "Bukit Mertajam" },
  { state: "Pulau Pinang", name: "Batu Kawan" },
  { state: "Pulau Pinang", name: "Nibong Tebal" },

  { state: "Putrajaya", name: "Putrajaya" },

  { state: "Sabah", name: "Kota Kinabalu" },
  { state: "Sabah", name: "Penampang" },
  { state: "Sabah", name: "Putatan" },
  { state: "Sabah", name: "Tuaran" },
  { state: "Sabah", name: "Sandakan" },
  { state: "Sabah", name: "Tawau" },
  { state: "Sabah", name: "Lahad Datu" },
  { state: "Sabah", name: "Keningau" },
  { state: "Sabah", name: "Semporna" },

  { state: "Sarawak", name: "Kuching" },
  { state: "Sarawak", name: "Kota Samarahan" },
  { state: "Sarawak", name: "Sibu" },
  { state: "Sarawak", name: "Miri" },
  { state: "Sarawak", name: "Bintulu" },
  { state: "Sarawak", name: "Sarikei" },
  { state: "Sarawak", name: "Sri Aman" },
  { state: "Sarawak", name: "Mukah" },

  { state: "Selangor", name: "Petaling Jaya" },
  { state: "Selangor", name: "Shah Alam" },
  { state: "Selangor", name: "Subang Jaya" },
  { state: "Selangor", name: "Klang" },
  { state: "Selangor", name: "Rawang" },
  { state: "Selangor", name: "Kajang" },
  { state: "Selangor", name: "Ampang Jaya" },
  { state: "Selangor", name: "Puchong" },
  { state: "Selangor", name: "Selayang" },
  { state: "Selangor", name: "Cyberjaya" },
  { state: "Selangor", name: "Bandar Sunway" },
  { state: "Selangor", name: "Bandar Utama" },
  { state: "Selangor", name: "Sepang" },

  { state: "Terengganu", name: "Kuala Terengganu" },
  { state: "Terengganu", name: "Kuala Nerus" },
  { state: "Terengganu", name: "Kemaman" },
  { state: "Terengganu", name: "Dungun" },
  { state: "Terengganu", name: "Marang" },
  { state: "Terengganu", name: "Besut" }
];

const STATE_ALIASES: Record<string, string> = {
  "ft kuala lumpur": "Kuala Lumpur",
  jb: "Johor",
  "johor darul takzim": "Johor",
  kl: "Kuala Lumpur",
  "klang valley": "Selangor",
  melacca: "Melaka",
  "negeri sembilan darul khusus": "Negeri Sembilan",
  penang: "Pulau Pinang",
  "perak darul ridzuan": "Perak",
  "perlis indera kayangan": "Perlis",
  "pulau pinang": "Pulau Pinang",
  "selangor darul ehsan": "Selangor"
};

const AREA_ALIASES: Record<string, string> = {
  "air itam": "Air Itam",
  "alor star": "Alor Setar",
  "batu kawan industrial park": "Batu Kawan",
  btw: "Butterworth",
  georgetown: "George Town",
  jb: "Johor Bahru",
  kk: "Kota Kinabalu",
  "mt kiara": "Mont Kiara",
  pj: "Petaling Jaya",
  "putra heights": "Subang Jaya",
  subang: "Subang Jaya",
  sunway: "Bandar Sunway",
  ttdi: "Taman Tun Dr Ismail"
};

export function resolveMalaysiaState(value: string) {
  const normalized = normalizeMalaysiaLocationValue(value);
  if (!normalized) {
    return "";
  }

  const alias = STATE_ALIASES[normalized];
  if (alias) {
    return alias;
  }

  return (
    Array.from(new Set(MALAYSIA_POPULAR_LOCATIONS.map((item) => item.state))).find(
      (state) => normalizeMalaysiaLocationValue(state) === normalized
    ) ?? value.trim()
  );
}

export function resolveMalaysiaArea(value: string, state?: string) {
  const normalized = normalizeMalaysiaLocationValue(value);
  if (!normalized) {
    return "";
  }

  const alias = AREA_ALIASES[normalized];
  if (alias) {
    return alias;
  }

  const matchedArea = MALAYSIA_POPULAR_LOCATIONS.find((item) => {
    const sameState = state ? item.state === state : true;
    return sameState && normalizeMalaysiaLocationValue(item.name) === normalized;
  });

  return matchedArea?.name ?? value.trim();
}

export function normalizeMalaysiaLocationValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
