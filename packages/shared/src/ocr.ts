export type OcrMedicationResult = {
  medicineName: string;
  dosageText: string;
  rawText: string;
};

export function parseMedicationText(rawText: string): OcrMedicationResult {
  const normalized = rawText.replace(/\s+/g, " ").trim();
  const lines = normalized.split(/[|,]/).map((item) => item.trim()).filter(Boolean);
  const medicineName = lines[0] || "Không xác định";
  const dosageText =
    lines.find((line) => /\d+\s?(mg|mcg|g|ml|vien|capsule|tablet)/i.test(line)) || "Chưa trích xuất liều dùng";
  return {
    medicineName,
    dosageText,
    rawText: normalized,
  };
}

export async function extractMedicationFromImage(_imageSource: string): Promise<OcrMedicationResult> {
  return parseMedicationText("Amlodipine 5mg uống 1 viên sau ăn sáng");
}
