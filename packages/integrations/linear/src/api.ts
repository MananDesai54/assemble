export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  state: string;
  url: string;
  description: string | null;
}

const QUERY = `
  query MyIssues {
    viewer {
      assignedIssues(
        filter: { state: { type: { nin: ["completed", "canceled"] } } }
        orderBy: updatedAt
        first: 25
      ) {
        nodes { id identifier title url description state { name } }
      }
    }
  }
`;

export async function myIssues(apiKey: string, fetchFn: typeof fetch = fetch): Promise<LinearIssue[]> {
  const res = await fetchFn('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!res.ok) throw new Error(`linear http ${res.status}`);
  const data = await res.json() as {
    errors?: { message: string }[];
    data?: { viewer?: { assignedIssues?: { nodes?: any[] } } };
  };
  if (data.errors?.length) throw new Error(`linear: ${data.errors[0].message}`);
  return (data.data?.viewer?.assignedIssues?.nodes ?? []).map(n => ({
    id: String(n.id),
    identifier: String(n.identifier),
    title: String(n.title),
    state: String(n.state?.name ?? ''),
    url: String(n.url),
    description: n.description ? String(n.description) : null,
  }));
}
