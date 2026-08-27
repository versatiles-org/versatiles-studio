# Test data

Real data, one file per format Studio can import, small enough to live in the repository.

**Every source here is public domain.** That is the reason these three were chosen over larger or
prettier alternatives: OpenStreetMap extracts are ODbL and Sentinel imagery is CC-BY, and both put an
attribution obligation on anything a test writes out. Nothing here does.

**Each file is a different dataset**, not one dataset converted eight ways - so a test that reads two
of them is reading two different shapes of real data, and a fixture that happens to suit one format's
quirks does not silently become the fixture for all of them.

## What is here

| File                   | Kind         | Content                                                       |
| ---------------------- | ------------ | ------------------------------------------------------------- |
| `places.shp`           | Vector data  | 15 cities of central Europe, as points                        |
| `countries.geojson`    | Vector data  | 42 European country borders, as polygons                      |
| `rivers.geojsonseq`    | Vector data  | The world's 13 major rivers, as lines, one JSON object a line |
| `earthquakes.csv`      | Table        | 150 earthquakes of magnitude 2.5 and above                    |
| `aerial.tif`           | Raster image | Aerial photography of San Francisco                           |
| `aerial-northwest.vrt` | Raster image | A virtual window onto the north-west quarter of `aerial.tif`  |
| `farmland.jpg`         | Raster image | Aerial photography of irrigated fields in Kansas              |
| `bluemarble.png`       | Raster image | Satellite imagery of the Alps and northern Italy              |

Geometry is deliberately spread across the three vector files - points, polygons and lines - because
`from_geo` reads all of them and a fixture set that was points three times would say nothing about
the other two.

`earthquakes.csv` names its coordinate columns `longitude` and `latitude`, which is the case where a
`from_csv` node arrives with `lon_column` and `lat_column` already filled in (S3.4). A file that
named them anything else would be the other case, and is worth adding when something needs it.

## Sidecars

`farmland.jpg` and `bluemarble.png` carry a world file (`.jgw`, `.pgw`) and a `.prj`, because neither
format holds georeferencing itself and a raster with no extent cannot be tiled. `places.shp` carries
the `.shx`, `.dbf`, `.cpg` and `.prj` a shapefile is not a shapefile without.

**`aerial-northwest.vrt` references `aerial.tif` by a relative path**, which is what a VRT normally
does and what makes this folder movable as a whole. It is also the case worth having: a path inside a
document that resolves against the document rather than the working directory.

## Where it came from

| Source                                                                   | Licence       | Files                                                  |
| ------------------------------------------------------------------------ | ------------- | ------------------------------------------------------ |
| [Natural Earth](https://www.naturalearthdata.com) 110m                   | Public domain | `places.shp`, `countries.geojson`, `rivers.geojsonseq` |
| [USGS earthquake feed](https://earthquake.usgs.gov/earthquakes/feed/)    | Public domain | `earthquakes.csv`                                      |
| [USGS NAIP](https://imagery.nationalmap.gov) via The National Map        | Public domain | `aerial.tif`, `aerial-northwest.vrt`, `farmland.jpg`   |
| [NASA GIBS](https://gibs.earthdata.nasa.gov) - Blue Marble shaded relief | Public domain | `bluemarble.png`                                       |

## How they were made

Cropped, simplified and scaled down from the sources above with GDAL 3.13. The whole folder is under
200 kB; the aerial GeoTIFF is JPEG-compressed with `PHOTOMETRIC=YCBCR`, which is how real aerial
GeoTIFFs and cloud-optimised GeoTIFFs are stored anyway.

```sh
# vectors - clipped to a region, attributes reduced to what a test would read
ogr2ogr -f "ESRI Shapefile" places.shp ne_110m_populated_places_simple.shp \
  -spat 4 44 20 56 -select name,adm0name,pop_max -lco ENCODING=UTF-8
ogr2ogr -f GeoJSON countries.geojson ne_110m_admin_0_countries.shp \
  -spat -12 35 32 62 -clipsrc -12 35 32 62 -select NAME,ISO_A3,POP_EST \
  -simplify 0.05 -lco COORDINATE_PRECISION=4
ogr2ogr -f GeoJSONSeq rivers.geojsonseq ne_110m_rivers_lake_centerlines.shp \
  -select name -simplify 0.05 -lco COORDINATE_PRECISION=4

# rasters - scaled down, and given the georeferencing the format cannot carry
gdal_translate -of GTiff -b 1 -b 2 -b 3 -outsize 256 256 \
  -co COMPRESS=JPEG -co JPEG_QUALITY=85 -co PHOTOMETRIC=YCBCR -co TILED=YES naip_sf.tif aerial.tif
gdal_translate -of VRT -srcwin 0 0 128 128 aerial.tif aerial-northwest.vrt
gdal_translate -of JPEG -a_srs EPSG:4326 -a_ullr -101.60 37.81 -101.52 37.75 \
  -co QUALITY=80 -co WORLDFILE=YES naip_fields.jpg farmland.jpg
gdal_translate -of PNG -a_srs EPSG:4326 -a_ullr 5 50 15 45 -b 1 -b 2 -b 3 \
  -outsize 256 128 -co WORLDFILE=YES -co ZLEVEL=9 gibs.png bluemarble.png
```

The earthquake feed is a rolling month, so `earthquakes.csv` is the 150 strongest of one download
rather than whatever the feed holds today - a fixture that changed under a test would be worse than
one that is a little stale.
