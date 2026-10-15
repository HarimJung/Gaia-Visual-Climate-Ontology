# KHM country seed — data only

This directory is data. It references platform seed vocabulary by seed IDs only — never by commit hash or line number (AD-7).
Engine code never reads these files directly; they enter a build only through seed loading (R1/R11).
