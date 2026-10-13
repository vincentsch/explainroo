// getUser and getOrders are application helpers, not the native fetch API.
// The callback version shows the success path. The promise versions add errors.
export const callback = `getUser(7, user => {
  getOrders(user.id, orders => {
    showOrders(orders);
  });
});`;

export const promise = `getUser(7)
  .then(user => {
    return getOrders(user.id);
  })
  .then(orders => showOrders(orders));`;

export const promiseErrors = `getUser(7)
  .then(user => {
    return getOrders(user.id);
  })
  .then(orders => showOrders(orders))
  .catch(err => showError(err));`;

export const awaited = `async function loadOrders() {
  const user = await getUser(7);
  const orders = await getOrders(user.id);
  showOrders(orders);
}`;

export const awaitedErrors = `async function loadOrders() {
  try {
    const user = await getUser(7);
    const orders = await getOrders(user.id);
    showOrders(orders);
  } catch (err) { showError(err); }
}`;
