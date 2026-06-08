import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Recharts from 'recharts';
import * as d3 from 'd3';
import { transform } from 'sucrase';

window.React = React;
window.ReactDOM = { createRoot: ReactDOM.createRoot };
window.Recharts = Recharts;
window.d3 = d3;
window.Sucrase = { transform };
