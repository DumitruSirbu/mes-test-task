/**
 * Format a minor-units (pence) amount as a £-prefixed decimal string. The DB / API
 * stores money as integer pence per data-model.md — UI is responsible for display.
 */
export const formatPricePence = (pence: number): string => {
    const pounds = pence / 100;

    return `£${pounds.toFixed(2)}`;
};
