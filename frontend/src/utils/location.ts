const locationReplacements: ReadonlyArray<readonly [RegExp, string]> = [
  [/Nguyễn Huệ/giu, 'Nguyen Hue Street'],
  [/Võ Văn Tần/giu, 'Vo Van Tan Street'],
  [/Điện Biên Phủ/giu, 'Dien Bien Phu Street'],
  [/Mai Chí Thọ/giu, 'Mai Chi Tho Street'],
  [/Lâm Văn Bền/giu, 'Lam Van Ben Street'],
  [/Nguyễn Văn Trỗi/giu, 'Nguyen Van Troi Street'],
  [/Bình Thạnh/giu, 'Binh Thanh District'],
  [/Phú Nhuận/giu, 'Phu Nhuan District'],
  [/Thủ Đức/giu, 'Thu Duc City'],
  [/Quận\s+(\d+)/giu, 'District $1'],
  [/TP\.?\s*HCM/giu, 'Ho Chi Minh City'],
];

/**
 * Converts administrative terms in legacy Vietnamese seed data to English.
 * Personal names and street names remain unchanged because they are proper nouns.
 */
export const formatLocationInEnglish = (value: string): string =>
  locationReplacements.reduce(
    (formatted, [pattern, replacement]) => formatted.replace(pattern, replacement),
    value,
  );
