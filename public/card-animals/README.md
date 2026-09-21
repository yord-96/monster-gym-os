# Modelos de tarjeta MONSTERS

Seis ilustraciones generadas con la herramienta integrada ImageGen: oso, león, tigre, lobo, gorila y toro. Los PNG conservan transparencia y se usan como marcas de agua en `MembershipCard`.

Prompt aplicado a cada animal:

> Create a single transparent PNG gym mascot illustration of a muscular anthropomorphic [bear / lion / tiger / wolf / gorilla / bull], head and upper torso with massive shoulders, three-quarter view facing slightly left. Detailed professional comic engraving/esports style, monochrome muted lavender and dark violet ink. Strong anatomy and disciplined fierce face. Isolated actual transparent alpha background. Entire silhouette contained with margin. No text, badges, frame or card. Match a premium dark purple gym membership watermark. Square asset.

Las variantes se asignan en orden 0–5 y vuelven a comenzar. `clients.card_variant` guarda la variante asignada y `settings.next_card_variant` guarda el siguiente modelo. Los clientes existentes reciben una variante una sola vez, por orden de registro. Editar, eliminar o renovar clientes no cambia los animales asignados a los demás.
