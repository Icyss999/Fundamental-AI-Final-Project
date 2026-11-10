export interface MenuItem {
  id: string;
  name: string;
  price: number;
}

export interface Order {
  id: string;
  items: { itemId: string; qty: number }[];
  paid: boolean;
}
