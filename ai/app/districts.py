"""The official 64 districts of Bangladesh, spelling variants, and regional
COD risk parameters. Mirrors server/src/data/districts.ts so both services
agree on what a valid district is."""

DISTRICTS = [
    "Bagerhat", "Bandarban", "Barguna", "Barishal", "Bhola", "Bogura",
    "Brahmanbaria", "Chandpur", "Chapainawabganj", "Chattogram", "Chuadanga",
    "Cumilla", "Cox's Bazar", "Dhaka", "Dinajpur", "Faridpur", "Feni",
    "Gaibandha", "Gazipur", "Gopalganj", "Habiganj", "Jamalpur", "Jashore",
    "Jhalokathi", "Jhenaidah", "Joypurhat", "Khagrachhari", "Khulna",
    "Kishoreganj", "Kurigram", "Kushtia", "Lakshmipur", "Lalmonirhat",
    "Madaripur", "Magura", "Manikganj", "Meherpur", "Moulvibazar",
    "Munshiganj", "Mymensingh", "Naogaon", "Narail", "Narayanganj",
    "Narsingdi", "Natore", "Netrokona", "Nilphamari", "Noakhali", "Pabna",
    "Panchagarh", "Patuakhali", "Pirojpur", "Rajbari", "Rajshahi",
    "Rangamati", "Rangpur", "Satkhira", "Shariatpur", "Sherpur", "Sirajganj",
    "Sunamganj", "Sylhet", "Tangail", "Thakurgaon",
]

# Common alternative spellings -> official name
VARIANTS = {
    "chittagong": "Chattogram", "ctg": "Chattogram", "barisal": "Barishal",
    "bogra": "Bogura", "comilla": "Cumilla", "jessore": "Jashore",
    "coxsbazar": "Cox's Bazar", "coxs bazar": "Cox's Bazar", "dhk": "Dhaka",
    "mymensing": "Mymensingh",
}


def find_district(text: str) -> str | None:
    """Find an official district name inside free text. None if not found."""
    lower = text.lower()
    for d in DISTRICTS:
        if d.lower() in lower:
            return d
    for variant, official in VARIANTS.items():
        if variant in lower:
            return official
    return None


# Regional COD-return risk (0 = safest, 1 = riskiest)
DISTRICT_RISK = {
    "Dhaka": 0.1, "Chattogram": 0.15, "Gazipur": 0.2, "Narayanganj": 0.2,
    "Khulna": 0.25, "Sylhet": 0.3, "Rajshahi": 0.25, "Barishal": 0.35,
    "Rangpur": 0.35, "Mymensingh": 0.3,
}
DEFAULT_DISTRICT_RISK = 0.4  # remote districts are riskier
