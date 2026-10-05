import { test } from 'node:test';
import assert from 'node:assert/strict';
import { punctuate, appendDictation } from '../src/lib/dictation.js';

test('pontuação falada', () => {
  assert.equal(punctuate('trinca na longarina vírgula lado direito ponto final'), 'trinca na longarina, lado direito.');
  assert.equal(punctuate('deixou a tocha nova linha deixou a garra'), 'deixou a tocha\ndeixou a garra');
  assert.equal(punctuate('qual a espessura ponto de interrogação'), 'qual a espessura?');
  assert.equal(punctuate('itens dois pontos'), 'itens:');
});

test('"ponto de solda" e "dois pontos de solda" não viram pontuação', () => {
  assert.equal(punctuate('refazer o ponto de solda da base'), 'refazer o ponto de solda da base');
  assert.equal(punctuate('dois pontos de solda soltos'), 'dois pontos de solda soltos');
  assert.equal(punctuate('soltou um ponto'), 'soltou um.');
});

test('junta com o texto do campo', () => {
  assert.equal(appendDictation('', 'portão arrastando'), 'Portão arrastando');
  assert.equal(appendDictation('Portão arrastando', 'roldana gasta'), 'Portão arrastando roldana gasta');
  assert.equal(appendDictation('Portão arrastando.', 'roldana gasta'), 'Portão arrastando. Roldana gasta');
  assert.equal(appendDictation('Portão arrastando', 'vírgula roldana gasta'), 'Portão arrastando, roldana gasta');
  assert.equal(appendDictation('Tocha\n', 'garra'), 'Tocha\nGarra');
  assert.equal(appendDictation('Texto ', ''), 'Texto ');
  assert.equal(appendDictation('', 'trinca ponto final solda nova'), 'Trinca. Solda nova');
});
