## WaterSim Three.js

Simulation interactive d’un fluide en trois dimensions avec la méthode SPH (Smoothed Particle Hydrodynamics), développée en JavaScript avec Three.js.

### Démonstration

https://nitrous-git.github.io/WaterSim_ThreeJs/ 

### Description

Le fluide est représenté par un ensemble de particules soumises aux forces de pression, de viscosité, de gravité et de cohésion.

La simulation physique est exécutée sur le CPU, tandis que le rendu est effectué avec WebGL. Une grille de hachage spatial tridimensionnelle accélère la recherche des particules voisines et réduit le coût des interactions SPH.

### Fonctionnalités
- Simulation SPH 3D en temps réel
- Calcul de la densité, de la pression et de la viscosité
- Gravité, cohésion et collisions avec les parois
- Recherche de voisins par hachage spatial
- Intégration d’Euler semi-implicite
- Interaction avec le fluide à la souris
- Paramètres physiques modifiables en temps réel
- Rendu direct des particules
- Rendu fluide continu en espace écran

  
### Rendu
L’application propose deux modes de visualisation :

- Water Particles : affichage direct des particules utilisées par le solveur SPH.
- Screen-Space Fluid : reconstruction visuelle d’une surface fluide avec profondeur, épaisseur, réfraction, absorption et réflexion.

### Contrôles
Utiliser la souris pour déplacer la caméra.
Activer Enable Interaction pour appliquer une force au fluide.
Maintenir le bouton gauche de la souris et déplacer le curseur.
Appuyer sur R pour réinitialiser la simulation.

### Technologies

- JavaScript ES Modules
- Three.js
- WebGL
- GLSL
- lil-gui

### Structure principale

- main.js : initialisation et boucle principale
- SPHSolver.js : calcul de la physique SPH
- SpatialHashGrid3D.js : recherche des particules voisines
- ParticleRenderer.js : rendu direct des particules
- ScreenSpaceFluidRenderer.js : rendu continu du fluide
  
### Limites

Les calculs SPH sont actuellement exécutés sur le CPU. Le nombre de particules et la stabilité de la simulation dépendent donc des performances du navigateur, du processeur et du pas de temps utilisé.
