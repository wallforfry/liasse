import { seededDigits } from '../identifiers.ts';
import { HOME_ADDRESS, PARTIES, SUBJECTS } from './cast.ts';
import { deDate, enDate, esDate, euroNumber } from '../format.ts';
import { pdf } from './layout.ts';
import {
  about,
  core,
  fact,
  field,
  keyDate,
  money,
  noKeyDate,
  optional,
  required,
  type ScenarioDocument,
  truth,
} from './model.ts';
import { TYPES } from './types.ts';
const TRIP_START = '2025-07-10';
const TRIP_END = '2025-07-24';
const TRAVEL_POLICY = `NTC-${seededDigits('travel-policy', 8)}`;

const travelInsurance: ScenarioDocument = {
  id: 'travel-insurance-2025-07',
  description: 'Certificate of travel insurance in English for a two-week trip',
  render: pdf([
    PARTIES.travelInsurer.printed,
    PARTIES.travelInsurer.address,
    'help@northmere-cover.example - Tel. 020 7946 0871',
    '',
    'CERTIFICATE OF TRAVEL INSURANCE',
    `Policy number: ${TRAVEL_POLICY}`,
    `Issued on ${enDate('2025-06-20')}`,
    '',
    'Insured person: Ms Jane Doe',
    'Additional traveller: Mr Malo Kerven',
    'Trip: Germany and Spain',
    `Cover starts: ${enDate(TRIP_START)}`,
    `Cover ends: ${enDate(TRIP_END)}`,
    '',
    'Plan: Single trip, Europe - medical expenses, cancellation, baggage',
    'Medical expenses limit: EUR 500,000 - Excess: EUR 75 per claim',
    'Premium paid: EUR 42.00 including insurance premium tax',
    '',
    'This certificate is evidence of cover. It cannot be renewed: a new',
    'policy is needed for each trip.',
  ]),
  truth: truth({
    type: TYPES.travelInsurance,
    core: core('en', {
      document_date: required('2025-06-20', enDate('2025-06-20')),
      issuer: required(PARTIES.travelInsurer.key, PARTIES.travelInsurer.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe', [PARTIES.malo.key]),
      amount: required(money(42), 'EUR 42.00'),
      period: required({ start: TRIP_START, end: TRIP_END }, `Cover starts: ${enDate(TRIP_START)}`),
      reference: required(TRAVEL_POLICY, TRAVEL_POLICY),
    }),
    key_dates: [
      keyDate('effective', TRIP_START, enDate(TRIP_START)),
      keyDate('expiry', TRIP_END, enDate(TRIP_END)),
      noKeyDate('renewal'),
    ],
    facts: [
      fact(
        'Northmere Travel Cover insured a trip to Germany and Spain from 2025-07-10 to 2025-07-24.',
        {
          entities: [PARTIES.travelInsurer.key],
          dates: [TRIP_START, TRIP_END],
        },
      ),
    ],
  }),
};

const HOTEL_ARRIVAL = '2025-07-14';
const HOTEL_DEPARTURE = '2025-07-17';
const HOTEL_STAY = `Anreise: ${deDate(HOTEL_ARRIVAL)} - Abreise: ${deDate(HOTEL_DEPARTURE)}`;

const hotelInvoice: ScenarioDocument = {
  id: 'hotel-invoice-2025-07',
  description: 'Hotel invoice in German for a three-night stay',
  render: pdf([
    PARTIES.hotel.printed,
    PARTIES.hotel.address,
    'info@gasthof-lindenhoehe.example',
    '',
    'RECHNUNG Nr. 2025-0713',
    `Rechnungsdatum: ${deDate(HOTEL_DEPARTURE)}`,
    '',
    'Gast: Frau Jane Doe',
    `${HOME_ADDRESS}, Frankreich`,
    `${HOTEL_STAY} - 3 Nächte, 2 Personen`,
    '',
    `Doppelzimmer mit Seeblick, 3 Nächte zu 98,00 EUR: ${euroNumber(294)} EUR`,
    `Frühstück, 6 x 9,50 EUR: ${euroNumber(57)} EUR`,
    `Kurtaxe, 6 x 2,00 EUR: ${euroNumber(12)} EUR`,
    '',
    `Gesamtbetrag: ${euroNumber(363)} EUR`,
    'Im Gesamtbetrag enthaltene Mehrwertsteuer (7 % und 19 %): 28,33 EUR',
    '',
    `Betrag dankend erhalten, bezahlt mit Karte am ${deDate(HOTEL_DEPARTURE)}.`,
    'Wir danken für Ihren Besuch und freuen uns auf ein Wiedersehen.',
  ]),
  truth: truth({
    type: TYPES.hotelInvoice,
    core: core('de', {
      document_date: required(HOTEL_DEPARTURE, deDate(HOTEL_DEPARTURE)),
      issuer: required(PARTIES.hotel.key, PARTIES.hotel.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: required(money(363), `Gesamtbetrag: ${euroNumber(363)} EUR`),
      period: required({ start: HOTEL_ARRIVAL, end: HOTEL_DEPARTURE }, HOTEL_STAY),
      reference: required('2025-0713', '2025-0713'),
    }),
    fields: [field(['nights', 'number_of_nights'], 'number', optional(3, '3 Nächte'))],
    key_dates: [noKeyDate('due')],
    facts: [
      fact('Jane Doe stayed three nights at the Gasthof Lindenhöhe from 2025-07-14 for 363 EUR.', {
        entities: [PARTIES.hotel.key],
        amounts: [money(363)],
      }),
    ],
  }),
};

const RENTAL_START = '2025-07-18';
const RENTAL_END = '2025-07-23';
// Spanish plates use consonants only: one made of vowels belongs to no car.
const RENTAL_PLATE = '0417 AEI';

const carRental: ScenarioDocument = {
  id: 'car-rental-receipt-2025-07',
  description:
    'Phone photo of a car rental invoice in Spanish: a car that is not the household car',
  render: {
    kind: 'image',
    encoding: 'jpeg',
    paper: 'photo',
    lines: [
      PARTIES.carRental.printed,
      PARTIES.carRental.address,
      'reservas@zubrenal.example',
      '',
      'FACTURA NUM. A-2025-1187',
      `Fecha: ${esDate(RENTAL_END)}`,
      '',
      'Cliente: Jane Doe',
      `Vehículo alquilado: Vrenko Lumo, matrícula ${RENTAL_PLATE}`,
      `Recogida: ${esDate(RENTAL_START)}`,
      `Devolución: ${esDate(RENTAL_END)}`,
      '',
      `5 días a 36,00 EUR: ${euroNumber(180)} EUR`,
      `Seguro a todo riesgo: ${euroNumber(25)} EUR`,
      `Combustible: ${euroNumber(9.5)} EUR`,
      '',
      `Total (IVA incluido): ${euroNumber(214.5)} EUR`,
      `Pagado con tarjeta el ${esDate(RENTAL_END)}.`,
      '¡Gracias por su confianza!',
    ],
  },
  truth: truth({
    type: TYPES.carRentalInvoice,
    core: core('es', {
      document_date: required(RENTAL_END, esDate(RENTAL_END)),
      issuer: required(PARTIES.carRental.key, PARTIES.carRental.printed),
      recipient: required(PARTIES.jane.key, 'Jane Doe'),
      amount: required(money(214.5), `Total (IVA incluido): ${euroNumber(214.5)} EUR`),
      period: required(
        { start: RENTAL_START, end: RENTAL_END },
        `Recogida: ${esDate(RENTAL_START)}`,
      ),
      reference: required('A-2025-1187', 'A-2025-1187'),
    }),
    fields: [
      field(
        ['license_plate', 'registration_number', 'plate_number', 'vehicle_registration'],
        'identifier',
        optional(RENTAL_PLATE, RENTAL_PLATE),
      ),
    ],
    key_dates: [noKeyDate('due')],
    // A rented car is not a thing the household owns: it must stay out of its vehicle file.
    subjects: [about(SUBJECTS.car, 'forbidden')],
    facts: [
      fact(
        'Jane Doe rented a car from Alquileres Zubrenal from 2025-07-18 to 2025-07-23 for 214.50 EUR.',
        {
          entities: [PARTIES.carRental.key],
          amounts: [money(214.5)],
        },
      ),
    ],
  }),
};

export const TRAVEL_DOCUMENTS: readonly ScenarioDocument[] = [
  travelInsurance,
  hotelInvoice,
  carRental,
];
