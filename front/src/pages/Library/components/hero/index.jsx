import { Stack } from "../../../../theme/ui";
import Actions from "./actions";
import Hero from "./hero";

export default function LibraryHero(props) {
  const components = [Hero, Actions];

  return (
    <Stack gap="2rem" py="2rem" align="center">
      {components.map((Component, index) => (
        <Component key={index} {...props} />
      ))}
    </Stack>
  );
}
