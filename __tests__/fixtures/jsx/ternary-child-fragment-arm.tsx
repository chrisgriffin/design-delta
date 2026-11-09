// One arm is a Fragment, which splices in an unknown number of siblings, so
// this ternary child renders MANY nodes rather than one.
export type ManyProps = { expanded?: boolean }

export function Many({ expanded }: ManyProps) {
  return (
    <ul>
      {expanded ? (
        <>
          <li>a</li>
          <li>b</li>
        </>
      ) : (
        <li>one</li>
      )}
    </ul>
  )
}
