import { type Snippet, snippetParts } from './snippet-parts.ts';

// Each part is a text node; only the marks around the matches are elements.
export const Highlighted = ({ snippet }: { readonly snippet: Snippet }) => (
  <>
    {snippetParts(snippet).map((part, index) =>
      part.marked ? (
        <mark
          key={index}
          className="rounded-sm bg-yellow-200 px-0.5 dark:bg-yellow-500/40 dark:text-foreground"
        >
          {part.text}
        </mark>
      ) : (
        <span key={index}>{part.text}</span>
      ),
    )}
  </>
);
