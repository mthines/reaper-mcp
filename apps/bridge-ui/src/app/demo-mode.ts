import { createDemo } from '../demo/demo.js';

export const DEMO = new URLSearchParams(location.search).has('demo') ? createDemo() : null;
