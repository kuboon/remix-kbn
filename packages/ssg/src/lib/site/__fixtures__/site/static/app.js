// The page loads this with <script src>; this one reaches the shared module by import alone.
import { label } from './shared.js'

document.title = `${document.title} (${label})`
