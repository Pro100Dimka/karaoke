import { Stack } from "../../../../theme/ui";
import Actions from "./actions";
import Hero from "./hero";

export default function LibraryHero(props) {
  return (
    <Stack gap="2rem" py="2rem" align="center">
      <Hero {...props} />
      <Actions {...props} />
    </Stack>
  );
}
