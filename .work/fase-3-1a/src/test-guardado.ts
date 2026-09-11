// Entrada focalizada: usa el export público de zone.js y tipos de navegador.
import 'zone.js/testing';
import { getTestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';

getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

import './app/services/grupos-data.service.spec';
import './app/components/editar-grupo/editar-grupo.component.spec';
