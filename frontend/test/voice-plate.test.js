// Comandos de voz e leitura de placa (funções puras do site).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, wordsToNumber } from '../src/lib/voice.js';
import { extractPlates, normalizePlate, plateFromSpeech, formatPlate } from '../src/lib/plate.js';

test('placa: normalização e formato', () => {
  assert.equal(normalizePlate('abc-1d23'), 'ABC1D23');
  assert.equal(normalizePlate('ABC 1234'), 'ABC1234');
  assert.equal(normalizePlate('AB12345'), null);
  assert.equal(formatPlate('ABC1234'), 'ABC-1234');
  assert.equal(formatPlate('ABC1D23'), 'ABC1D23');
});

test('placa pela foto (OCR): corrige trocas comuns por posição e ignora BRASIL', () => {
  assert.deepEqual(extractPlates('BRASIL\nABC1D23'), ['ABC1D23']);
  assert.equal(extractPlates('BR4 5B12')[0], 'BRA5B12');            // 4→A na 3ª letra
  assert.equal(extractPlates('QWE-I234')[0], 'QWE1234');            // I→1 na 4ª posição
  assert.equal(extractPlates('placa: RIO2O19 ok')[0], 'RIO2O19');    // Mercosul com O na 5ª posição
  assert.deepEqual(extractPlates('sem placa aqui'), []);
});

test('placa falada', () => {
  assert.equal(plateFromSpeech('placa a be ce um de dois três'), 'ABC1D23');
  assert.equal(plateFromSpeech('placa ABC 1D23 problema na porta'), 'ABC1D23');
  assert.equal(plateFromSpeech('placa q w e um dois três quatro'), 'QWE1234');
});

test('números por extenso', () => {
  assert.equal(wordsToNumber('cento e vinte e três'), 123);
  assert.equal(wordsToNumber('quarenta e dois'), 42);
  assert.equal(wordsToNumber('120'), 120);
  assert.equal(wordsToNumber('banana'), null);
});

test('abrir nova OS com cliente, placa, problema e prioridade', () => {
  const c = parseCommand('Abrir ordem de serviço para João da Silva, placa ABC 1D23, problema solda no para-choque, urgente');
  assert.equal(c.intent, 'abrir_os');
  assert.equal(c.customer, 'João da Silva');
  assert.equal(c.plate, 'ABC1D23');
  assert.equal(c.problem, 'Solda no para-choque');
  assert.equal(c.priority, 'urgente');
});

test('abrir nova OS só com problema', () => {
  const c = parseCommand('nova OS problema portão arrastando');
  assert.equal(c.intent, 'abrir_os'); assert.equal(c.problem, 'Portão arrastando'); assert.equal(c.customer, undefined);
});

test('apontamento: iniciar, parar e lançar horas', () => {
  let c = parseCommand('Iniciar apontamento na OS 120');
  assert.equal(c.intent, 'iniciar_apontamento'); assert.equal(c.order_number, 120);
  c = parseCommand('iniciar cronômetro na ordem de serviço cento e vinte');
  assert.equal(c.intent, 'iniciar_apontamento'); assert.equal(c.order_number, 120);
  c = parseCommand('Parar apontamento');
  assert.equal(c.intent, 'parar_apontamento'); assert.equal(c.order_number, undefined);
  c = parseCommand('Apontar 2 horas e 30 minutos na OS 120');
  assert.equal(c.intent, 'apontar_horas'); assert.equal(c.minutes, 150); assert.equal(c.order_number, 120);
  c = parseCommand('apontar meia hora na os 7');
  assert.equal(c.minutes, 30); assert.equal(c.order_number, 7);
  c = parseCommand('apontar 45 minutos na OS 9');
  assert.equal(c.minutes, 45);
});

test('anotação, etapa e abrir OS existente', () => {
  let c = parseCommand('Anotar na OS 120 que o cliente autorizou a troca da dobradiça');
  assert.equal(c.intent, 'anotar'); assert.equal(c.order_number, 120); assert.equal(c.note, 'O cliente autorizou a troca da dobradiça');
  c = parseCommand('Mudar a OS 120 para pronta');
  assert.equal(c.intent, 'status'); assert.equal(c.status, 'pronta');
  c = parseCommand('passar a ordem de serviço 33 para em execução');
  assert.equal(c.status, 'em_execucao'); assert.equal(c.order_number, 33);
  c = parseCommand('Abrir a OS 120');
  assert.equal(c.intent, 'abrir_existente'); assert.equal(c.order_number, 120);
  assert.equal(parseCommand('bom dia').intent, 'desconhecido');
});
