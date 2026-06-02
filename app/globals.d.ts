declare module "*.css";

declare namespace JSX {
  interface IntrinsicElements {
    "s-app-nav": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-link": React.DetailedHTMLProps<React.AnchorHTMLAttributes<HTMLElement>, HTMLElement> & { href?: string };
    "s-page": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-button": React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLElement>, HTMLElement> & { variant?: string; tone?: string };
    "s-section": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-card": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-badge": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { tone?: string };
    "s-text": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { variant?: string; as?: string };
    "s-box": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-inline": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-stack": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-divider": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-spinner": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-toast": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-modal": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-form-layout": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-text-field": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { label?: string; value?: string; onChange?: (e: CustomEvent) => void }, HTMLElement>;
    "s-select": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { label?: string; value?: string; onChange?: (e: CustomEvent) => void }, HTMLElement>;
    "s-checkbox": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { label?: string; checked?: boolean; onChange?: (e: CustomEvent) => void }, HTMLElement>;
  }
}
