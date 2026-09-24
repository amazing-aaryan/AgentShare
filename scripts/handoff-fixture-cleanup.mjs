/** Revoke persisted shares, including commits whose RPC response was lost. */
export async function revokeHandoffFixtures({ closeOwner, loadOwned, revoke }) {
  await closeOwner();
  const failedIds = [];
  for (const environment of await loadOwned()) {
    try {
      await revoke(environment);
    } catch {
      failedIds.push(environment.environmentId);
    }
  }
  return failedIds;
}
