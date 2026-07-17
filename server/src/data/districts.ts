// The 64 districts of Bangladesh + a spelling normalizer and regional risk.

export const DISTRICTS = [
  'Bagerhat', 'Bandarban', 'Barguna', 'Barishal', 'Bhola', 'Bogura',
  'Brahmanbaria', 'Chandpur', 'Chapainawabganj', 'Chattogram', 'Chuadanga',
  'Cumilla', "Cox's Bazar", 'Dhaka', 'Dinajpur', 'Faridpur', 'Feni',
  'Gaibandha', 'Gazipur', 'Gopalganj', 'Habiganj', 'Jamalpur', 'Jashore',
  'Jhalokathi', 'Jhenaidah', 'Joypurhat', 'Khagrachhari', 'Khulna',
  'Kishoreganj', 'Kurigram', 'Kushtia', 'Lakshmipur', 'Lalmonirhat',
  'Madaripur', 'Magura', 'Manikganj', 'Meherpur', 'Moulvibazar',
  'Munshiganj', 'Mymensingh', 'Naogaon', 'Narail', 'Narayanganj',
  'Narsingdi', 'Natore', 'Netrokona', 'Nilphamari', 'Noakhali', 'Pabna',
  'Panchagarh', 'Patuakhali', 'Pirojpur', 'Rajbari', 'Rajshahi',
  'Rangamati', 'Rangpur', 'Satkhira', 'Shariatpur', 'Sherpur', 'Sirajganj',
  'Sunamganj', 'Sylhet', 'Tangail', 'Thakurgaon',
];

// Common alternative spellings -> official name
const VARIANTS: Record<string, string> = {
  chittagong: 'Chattogram', ctg: 'Chattogram', barisal: 'Barishal',
  bogra: 'Bogura', comilla: 'Cumilla', jessore: 'Jashore',
  coxsbazar: "Cox's Bazar", 'coxs bazar': "Cox's Bazar", dhk: 'Dhaka',
  mymensing: 'Mymensingh', rajshahi: 'Rajshahi',
};

// Find an official district name inside free text. Returns null if none found.
export function findDistrict(text: string): string | null {
  const lower = text.toLowerCase();
  for (const d of DISTRICTS) {
    if (lower.includes(d.toLowerCase())) return d;
  }
  for (const [variant, official] of Object.entries(VARIANTS)) {
    if (lower.includes(variant)) return official;
  }
  return null;
}

// rough regional COD-return risk (0 = safest, 1 = riskiest).
export const DISTRICT_RISK: Record<string, number> = {
  Dhaka: 0.1, Chattogram: 0.15, Gazipur: 0.2, Narayanganj: 0.2,
  Khulna: 0.25, Sylhet: 0.3, Rajshahi: 0.25, Barishal: 0.35,
  Rangpur: 0.35, Mymensingh: 0.3,
};
export const DEFAULT_DISTRICT_RISK = 0.4; // remote districts are riskier
