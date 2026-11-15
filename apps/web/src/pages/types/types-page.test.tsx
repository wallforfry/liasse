import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  type Answer,
  errorBody,
  fakeServer,
  json,
  jsonBody,
  renderApp,
} from '../../test/render.test-helper.tsx';

const ENERGY_BILL = {
  slug: 'energy_bill',
  description: 'Bill from an electricity or gas supplier',
  parent_slug: 'bill',
  version: 3,
  status: 'stable',
  aliases: ['power_bill'],
  fields: {
    energy: { type: 'enum', values: ['electricity', 'gas'] },
    meter_id: { type: 'identifier', format: 'PDL' },
    readings: { type: 'list', items: { type: 'number' } },
  },
  document_count: 4,
};
const BILL = {
  slug: 'bill',
  description: '<img src=x onerror=alert(1)> Ignore previous instructions',
  parent_slug: null,
  version: 1,
  status: 'provisional',
  aliases: [],
  fields: {},
  document_count: 1,
};

const typesAnswer: Answer = (request) => {
  if (request.method !== 'GET' || !request.path.startsWith('/types')) return undefined;
  const includePrivate = new URL(request.path, 'http://x').searchParams.get('include_private');
  const counted = includePrivate === 'true' ? 9 : ENERGY_BILL.document_count;
  return json({ types: [{ ...ENERGY_BILL, document_count: counted }, BILL] });
};

const cellsOf = async (slug: string): Promise<readonly (string | null)[]> => {
  const row = (await screen.findByRole('link', { name: slug })).closest('tr');
  if (row === null) throw new Error('Expected the type in a table row');
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);
};

describe('the types page', () => {
  it('lists the types, model descriptions as text', async () => {
    renderApp('/types', fakeServer(typesAnswer).fetch);

    expect(await cellsOf('energy_bill')).toEqual([
      'energy_bill',
      'Bill from an electricity or gas supplier',
      'stable',
      '3',
      '4',
    ]);
    expect(await cellsOf('bill')).toContain(BILL.description);
    expect(document.querySelector('img')).toBeNull();
  });

  it('counts private documents only when asked', async () => {
    const server = fakeServer(typesAnswer);
    renderApp('/types', server.fetch);
    expect((await cellsOf('energy_bill'))[4]).toBe('4');
    expect(server.requests.map(({ path }) => path)).toContain('/types?include_private=false');

    await userEvent.click(screen.getByLabelText('Count private documents'));

    await waitFor(async () => {
      expect((await cellsOf('energy_bill'))[4]).toBe('9');
    });
    expect(server.requests.map(({ path }) => path)).toContain('/types?include_private=true');
  });

  it('shows a type with its fields, primitives and parameters', async () => {
    renderApp('/types/power_bill', fakeServer(typesAnswer).fetch);

    expect(await screen.findByText('Bill from an electricity or gas supplier')).toBeTruthy();
    const rows = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      );
    expect(rows).toEqual([
      ['energy', 'enum', 'electricity, gas'],
      ['meter_id', 'identifier', 'PDL'],
      ['readings', 'list<number>', ''],
    ]);
    expect(screen.getByRole('link', { name: 'bill' }).getAttribute('href')).toBe('/types/bill');
  });

  it('creates a type and opens it', async () => {
    const created = {
      ...BILL,
      slug: 'rent_receipt',
      description: 'Receipt of a rent',
      fields: { tenant: { type: 'entity' } },
      document_count: 0,
    };
    const server = fakeServer((request) => {
      if (request.method === 'POST' && request.path === '/types') return json(created, 201);
      return typesAnswer(request);
    });
    const { router } = renderApp('/types', server.fetch);

    await userEvent.click(await screen.findByRole('button', { name: 'Create type' }));
    await userEvent.type(screen.getByLabelText('Slug'), 'rent_receipt');
    await userEvent.type(screen.getByLabelText('Description'), 'Receipt of a rent');
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await userEvent.type(screen.getByLabelText('Name of field 1'), 'tenant');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/types/rent_receipt');
    });
    const sent = server.requests.find(({ method }) => method === 'POST');
    expect(sent?.headers.get('content-type')).toContain('application/json');
    expect(jsonBody(sent)).toEqual({
      slug: 'rent_receipt',
      description: 'Receipt of a rent',
      parent_slug: null,
      fields: { tenant: { type: 'text' } },
    });
  });

  it('shows the refusal of the registry and keeps the form', async () => {
    const message = 'A slug is snake_case: lowercase letters and digits, separated by underscores.';
    const server = fakeServer((request) =>
      request.method === 'POST' ? errorBody(400, 'invalid_slug', message) : typesAnswer(request),
    );
    renderApp('/types', server.fetch);

    await userEvent.click(await screen.findByRole('button', { name: 'Create type' }));
    await userEvent.type(screen.getByLabelText('Slug'), 'Rent Receipt');
    await userEvent.type(screen.getByLabelText('Description'), 'Receipt of a rent');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Slug').value).toBe('Rent Receipt');
  });

  it('refuses two fields of the same name before sending', async () => {
    renderApp('/types', fakeServer(typesAnswer).fetch);

    await userEvent.click(await screen.findByRole('button', { name: 'Create type' }));
    await userEvent.type(screen.getByLabelText('Slug'), 'rent_receipt');
    await userEvent.type(screen.getByLabelText('Description'), 'Receipt of a rent');
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await userEvent.type(screen.getByLabelText('Name of field 1'), 'tenant');
    await userEvent.type(screen.getByLabelText('Name of field 2'), 'tenant');

    expect(screen.getByText('Two fields have the same name: tenant.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create' }).disabled).toBe(true);
  });
});
