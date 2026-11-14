// Business types the owner picks in guided setup. Each names the one main
// pattern pack that fits it best; the owner can add extra packs later.
export const businessTypes: readonly {
  id: string;
  en: string;
  ms: string;
  pack: string;
}[] = Object.freeze([
  { id: "hair-salon", en: "Hair or beauty salon", ms: "Salun rambut atau kecantikan", pack: "appointment" },
  { id: "clinic", en: "Clinic or dental clinic", ms: "Klinik atau klinik gigi", pack: "appointment" },
  { id: "parts-shop", en: "Shop selling parts or goods", ms: "Kedai alat ganti atau barangan", pack: "stock-price" },
  { id: "aircond-contractor", en: "Air-con or home repair contractor", ms: "Kontraktor aircond atau pembaikan rumah", pack: "quote-visit" },
  { id: "bakery-catering", en: "Bakery, cakes or catering", ms: "Kedai kek, kuih atau katering", pack: "order" },
  { id: "homestay", en: "Homestay or hall rental", ms: "Homestay atau sewaan dewan", pack: "reservation-rental" },
  { id: "restaurant", en: "Restaurant taking table bookings", ms: "Restoran (tempahan meja)", pack: "reservation-rental" },
  { id: "tuition-centre", en: "Tuition centre or kindergarten", ms: "Pusat tuisyen atau tadika", pack: "enrolment-lead" },
  { id: "law-firm", en: "Law or consulting firm", ms: "Firma guaman atau perundingan", pack: "case-intake" },
  { id: "car-workshop", en: "Car workshop", ms: "Bengkel kereta", pack: "status-check" },
  { id: "laundry-repair", en: "Laundry or repair shop", ms: "Dobi atau kedai baiki", pack: "status-check" },
  { id: "other", en: "Something else", ms: "Lain-lain", pack: "every-business" },
]);

// The business type text stored on the workspace (and shown to the agent as
// the kind of business): the picked type's English label, or for "Something
// else" the owner's own words, trimmed. Empty when nothing usable was given.
export function businessTypeText(typeId: string, ownWords: string): string {
  const type = businessTypes.find((t) => t.id === typeId);
  if (!type) return "";
  return type.id === "other" ? ownWords.trim() : type.en;
}

// The type to preselect from the stored text: the type whose English label
// it is; any other text was typed for "Something else". The pack always
// comes from the type, never from the words.
export function typeIdForSaved(
  saved: string | null | undefined,
): string | undefined {
  const text = saved?.trim();
  if (!text) return undefined;
  return businessTypes.find((t) => t.en === text)?.id ?? "other";
}
