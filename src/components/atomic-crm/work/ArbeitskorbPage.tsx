import { ArbeitskorbSurface } from "./ArbeitskorbSurface";

/**
 * Desktop Arbeitskorb page (docs/nora/26 §8). Rendered inside the existing
 * `Layout`, whose `main#main-content` holds the page; the `h1` lives in the
 * surface, inside that `main`. Loaded lazily per route (AC-29).
 */
const ArbeitskorbPage = () => <ArbeitskorbSurface variant="desktop" />;

export default ArbeitskorbPage;
