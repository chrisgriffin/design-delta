// An exported component whose props parameter is destructured but carries NO
// type annotation. The props census cannot read it, but it IS a component and
// therefore still needs a contract — pins the "confirmed component, unreadable
// props" path.
export const UntypedProps = ({ ...props }) => <span {...props} />
