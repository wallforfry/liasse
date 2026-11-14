import { nameTokens } from '../domain/entity-name.ts';

// What two labels must share to name the same subject: their words, lowercase, without
// accents on Latin letters, in the letters and digits of every script. No legal form is
// dropped, as it is from an entity name: "sa", "as" or "ab" are words of a label. A label
// written without any letter or digit is compared as written.
export const subjectLabelKey = (label: string): string => {
  const tokens = nameTokens(label);
  return tokens.length > 0 ? tokens.join(' ') : label.normalize('NFKC').trim().toLowerCase();
};

const MIN_LABEL_LENGTH = 3;

// Scripts in which one or two characters are a whole word.
const DENSE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

// A label too short to tell one subject from another, "a" or "n1", names nothing: it is
// never matched, by equality or by similarity.
export const isDistinctiveLabel = (label: string): boolean => {
  const letters = nameTokens(label).join('');
  return Array.from(letters).length >= MIN_LABEL_LENGTH || DENSE_SCRIPT.test(letters);
};
