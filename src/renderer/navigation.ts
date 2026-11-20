export const sections = [
  'Overview',
  'Customers',
  'Medicines',
  'Purchases',
  'Follow-ups',
  'Reports',
  'Settings',
] as const;
export type Section = (typeof sections)[number];
export type NavigationIntent = {
  key: string;
  action:
    | 'list'
    | 'newCustomer'
    | 'newMedicine'
    | 'newPurchase'
    | 'due'
    | 'scheduled'
    | 'all'
    | 'supplies'
    | 'backups'
    | 'exports';
  id?: string;
};
export type Navigate = (
  section: Section,
  action?: NavigationIntent['action'],
  id?: string,
  returnTo?: Section,
) => void;
