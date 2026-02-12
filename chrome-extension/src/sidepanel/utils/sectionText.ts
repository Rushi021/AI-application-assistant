export type SectionTextParts = {
  header?: string;
  bullets: string[];
  body: string[];
};

const BULLET_REGEX = /^\s*[•\-\–\*]\s*(.+)$/;

const isBulletLine = (line: string) => BULLET_REGEX.test(line);

const extractBulletText = (line: string): string | null => {
  const match = BULLET_REGEX.exec(line);
  if (!match) return null;
  const text = match[1].trim();
  return text.length > 0 ? text : null;
};

export const parseSectionText = (text: string): SectionTextParts => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let header: string | undefined;
  let startIndex = 0;

  for (let i = 0; i < lines.length; i += 1) {
    if (!isBulletLine(lines[i])) {
      header = lines[i];
      startIndex = i + 1;
      break;
    }
  }

  const bullets: string[] = [];
  const body: string[] = [];

  for (let i = startIndex; i < lines.length; i += 1) {
    const bulletText = extractBulletText(lines[i]);
    if (bulletText) {
      bullets.push(bulletText);
    } else {
      body.push(lines[i]);
    }
  }

  return { header, bullets, body };
};
