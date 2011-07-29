//@include tpconstants.jsx
//@include tpsettings.jsx
//@include tpreorder.jsx
//@include tphelpers.jsx
//@include TychTransformations.jsx
//@include layerMaskLib.9.jsx


/*
 * Tych constructor.
 */
var Tych = function(settings)
{
	this.tych_variant = NTYCH_HORIZONTAL;
	// Save current unit preferences.
	this.rulerUnits = preferences.rulerUnits;
	// Change unit preferences.
	preferences.rulerUnits = Units.PIXELS;

	// Save a reference to the current open document if there is one.
	// New layouts may be merged and composited into this document later.
	this.comp_target_doc = documents.length > 0 ? activeDocument : null;

	this.settings = settings;
}


/**
 * Select the images that should be part of this Tych.
 */
Tych.prototype.select = function()
{
	var images, thumbs;

	// Use bridge selection if there is one.
	if (this.settings.use_bridge_selection && BridgeTalk.isRunning('bridge')) {
		var bridge_selection = tp_get_bridge_selection();
		images = bridge_selection[0];
		thumbs = bridge_selection[1];
	}

	if (images == undefined || images.length < 1)
		images = File.openDialog("Choose file(s) to add to composite", undefined, true);

	if (images != undefined && images.length > 1 && this.settings.reorder)
		images = tp_reorder(images, thumbs);

	if (images == undefined || images.length < 1) {
		// No images were selected or the reorder window was dismissed. Revert
		// settings and stop the script.
		this.revert();
		return false;
	}


	// If the user opens a file that is already open we will have a document
	// collision problem. To solve it we duplicate the open, colliding document
	// to get a copy of it with a new name. We then close the original
	// document.
	for (i in images) {
		try {
			var docc = documents.getByName(images[i].name);
			this.comp_target_doc = docc.duplicate();
			docc.close(SaveOptions.DONOTSAVECHANGES);
		} catch (err) { }
	}

	this.images = images;
	return true;
}


Tych.prototype.revert = function()
{
	preferences.rulerUnits = this.rulerUnits;
}


/**
 * Stack the images of this Tych instance.
 */
Tych.prototype.stack = function()
{
	var tych = this;
	var last = this.images.length - 1;
	var doc = app.open(this.images[last]);


	f = function() {
		var d = doc;
		var maxx = doc.width;
		var maxy = doc.height;

		d.flatten();
		d.layers[0].isBackgroundLayer = false;

		if (tych.settings.convert_to_smartobject)
			tp_make_smart_object();

		for (i = last; i >= 0; i--) {

			if (i < last) {
				d = app.open(tych.images[i]);
				d.flatten();
				d.selection.selectAll();

				if (d.layers.length > 1)
					d.selection.copy(true);
				else
					d.selection.copy();

				maxx = Math.max(maxx, d.width);
				maxy = Math.max(maxy, d.height);
				d.close(SaveOptions.DONOTSAVECHANGES);
				activeDocument = doc;
				doc.paste();
				doc.layers[0].translate(-doc.layers[0].bounds[0].value, -doc.layers[0].bounds[1].value);

				if (tych.settings.convert_to_smartobject)
					tp_make_smart_object();
			}

		}
		doc.resizeCanvas(maxx, maxy, AnchorPosition.TOPLEFT);

		// If mask option is enabled, add a layer mask to each layer.
		if (tych.settings.mask_layers)
			for (i = 0; i < doc.layers.length; i++)
				tp_mask(doc.layers[i]);
	}

	doc.suspendHistory('Stack images', 'f()');

	this.doc = doc;
	this.n = doc.layers.length;
	this.trans = new TychTransformations(this.doc.layers, this.settings);
}


Tych.prototype.layout = function(tych_variant)
{
	this.tych_variant = tych_variant;

	if (documents.length < 1) {
		this.select();
		var required = this.validate_input(tych_variant, this.images.length);

		if (required > this.images.length) {
			alert('This action requires that you select ' + required + ' images. Please try again.');
			this.revert();
			return -1;
		}

		// Stack it up.
		this.stack();
	} else {
		var d = activeDocument;
		var required = -1;
		var required = this.validate_input(tych_variant, d.layers.length);

		// Check if this is a tych that's already been laid out once.
		if (d.layers.length == required + 1) {
			this.finish();
			return;
		}

		// Ugly workaround for Windows bug. If we use the original document
		// weird things start to happen for no apparent reason. So we use a
		// duplicate instead.
		this.doc = d.duplicate();
		this.comp_target_doc = null;
		d.close(SaveOptions.DONOTSAVECHANGES);

		if (required > this.doc.layers.length) {
			alert('This action requires ' + required + ' layers. Stack some more layers then try again.');
			this.revert();
			return -1;
		}
	}

	// Compute transformations (prepare for layout).
	this.trans.compute(tych_variant);


	// Layout the selected images.
	this.make();

	// Save, close etc.
	this.finish();
}


Tych.prototype.validate_input = function(tych_variant, number)
{
	var required = -1;

	if (tych_variant < 3)
		required = 2;
	else if (tych_variant > 2 && tych_variant < 6)
		required = 3;
	else
		required = 4;

	return required;
}


Tych.prototype.finish = function()
{
	// Make a reference to the document that should be saved.
	this.save_doc = this.comp_target_doc == null ? this.doc : this.comp_target_doc;
	
	// Unlink all layer masks.
	if (this.save_doc.layerSets.length > 0) {
		for (var i = 0; i < this.save_doc.layerSets.length; i++) {
			for (var j = 0; j < this.save_doc.layerSets[i].layers.length; j++) {
				this.save_doc.activeLayer = this.save_doc.layerSets[i].layers[j];
				layerMask.link(false);
			}
		}
	} else {
		for (var i = 0; i < this.save_doc.layers.length; i++) {
			this.save_doc.activeLayer = this.save_doc.layers[i];
			layerMask.link(false);
		}
	}

	if (this.save_doc.layers[this.save_doc.layers.length - 1].name == 'Background')
		tp_fill_background(this.save_doc, WHITE);
	else 
		tp_add_background(this.save_doc, WHITE);

	if (this.settings.autosave)
		this.save(this.save_doc);
	
	if (this.settings.autoclose)
		this.save_doc.close(SaveOptions.DONOTSAVECHANGES);

	// Revert settings.
	this.revert();
}


Tych.prototype.layout_and_composite = function()
{
	// Select the images to layout.
	if (!this.select()) {
		// Abort if no images are selected.
		this.revert();
		return;
	}
	
	// Stack it up.
	this.stack();

	var thiss = this;

	var g = function() {
		// Compute transformations (prepare for layout).
		thiss.trans.compute(NTYCH_HORIZONTAL);
		
		// Layout the selected images according to the transformations just
		// computed.
		thiss.make();

		// Composite the result.
		if (thiss.comp_target_doc != null)
			thiss.place_comp(thiss.doc, thiss.comp_target_doc);

		// Save, close etc.
		thiss.finish();
	}

	this.doc.suspendHistory('Make ntych', 'g()');
}


/**
 * Places the contents of one document at the bottom of another.
 */
Tych.prototype.place_comp = function(src, target)
{
	var i, placement;
	var src_height = src.height;
	var target_height = target.height;

	activeDocument = target;

	// Get rid of outside pixels;
	//target.crop([0, 0, target.width, target.height]);

	if (target.layerSets.length == 0) {
		var layers_to_move = [];
		for (i = 0; i < target.layers.length - 1; i++)
			layers_to_move[i] = target.layers[i];

		var row_1 = target.layerSets.add();
		row_1.name = 'Row 1';

		this.move_into_set(layers_to_move, row_1);
	}


	var row_n = target.layerSets.add();
	var layer_count = target.layers.length;
	row_n.name = 'Row ' + target.layerSets.length;
	target.activeLayer = row_n;

	// Unlock the background (if locked) so we can put a background fill below.
	target.layers[target.layers.length - 1].isBackgroundLayer = false;

	for (i = 0; i < src.layers.length; i++)
		this.copy_layer_to_document(src.layers[i], target);

	//return;

	layers_to_move = [];
	for (i = 0; i < src.layers.length; i++)
		layers_to_move[i] = target.layers[i];

	this.move_into_set(layers_to_move, row_n);

	src.close(SaveOptions.DONOTSAVECHANGES);

	/*
	activeDocument = target;
	target.activeLayer = target.layers[0];
	
	*/

	activeDocument = target;
	target.resizeCanvas(target.width, target.height + src_height + this.settings.spacing, AnchorPosition.TOPLEFT);

	row_n.translate(0, target_height - target.activeLayer.bounds[1] + this.settings.spacing);
}


/**
 * Saves the specified document according to the output options set in the
 * options dialog. If any of the files already exist the sequence number will
 * be incremented.
 *
 * For example: Assume that the options are set to output both jpg and psd
 * files with the file name set to "image". If the file image_001.jpg already
 * exists, then the files will be saved to image_002.jpg and image_002.psd so
 * that nothing is overwritten.
 */
Tych.prototype.save = function()
{
	var basename = this.settings.filename + '_';
	var padding = '001';
	var collision;
	var file;

	while(true) {
		collision = false;
		for (format in this.settings.output_formats) {
			file = new File(this.settings.save_directory + '/' + basename + padding + '.' + format);
			if (file.exists) {
				collision = true;
				break;
			}
		}
		// Increase the sequential number by 1 if there is a file name collision.
		if (collision)
			padding = tp_zero_pad(Number(padding) + 1, 3);
		else
			break;
	}

	var options = {
		'jpg': this.get_jpeg_save_options(),
		'psd': this.get_psd_save_options()
	};

	for (format in this.settings.output_formats)
		if (this.settings.output_formats[format])
			this.save_doc.saveAs(
				new File(this.settings.save_directory + '/' + basename + padding),
				options[format], true, Extension.LOWERCASE);
}



/**
 * Makes an horizontal n-tych by spacing out the layers in the specified
 * document.
 */
Tych.prototype.make = function()
{
	this.trans.apply();
	this.add_seams();

	// Get rid of outside pixels;
	//this.save_doc = this.comp_target_doc == null ? this.doc : this.comp_target_doc;
	this.doc.crop([0, 0, this.doc.width, this.doc.height]);
}


/**
 * Makes the seams / borders of the specified document crisp by deleting the
 * pixels that overlap them.
 */
Tych.prototype.add_seams = function()
{
	var t = this.trans.matrix;
	var l = this.doc.layers;
	var spacing =  this.settings.spacing;
	var width = this.trans.target_size[0];
	var height = this.trans.target_size[1];


	if (this.tych_variant == TRIPTYCH_PORTRAIT_LANDSCAPE_GRID
			|| this.tych_variant == TRIPTYCH_LANDSCAPE_PORTRAIT_GRID) {
		// Index of portrait layer.
		var p = tp_lheight(l[0]) > tp_lheight(l[1]) ? 0 : 2;
		p = tp_lheight(l[1]) > tp_lheight(l[2]) ? 1 : p;

		// Indicies of landscape layers.
		var la;
		if (p == 0) la = Array(1, 2);
		else if (p == 1) la = Array(0, 2);
		else la = Array(0, 1);

		var v = this.tych_variant == TRIPTYCH_PORTRAIT_LANDSCAPE_GRID ? la[0] : p;

		// Select vertical seam.
		this.doc.selection.select(sel = Array(
			Array(t[v][1][0] - spacing + 1, 0),
			Array(t[v][1][0] - spacing + 1, height),
			Array(t[v][1][0] + 1, height),
			Array(t[v][1][0] + 1, 0),
		));
		this.clear_selected();

		// Select horizontal seam.
		this.doc.selection.select(sel = Array(
			Array(0, t[la[1]][1][1] - spacing + 1),
			Array(width, t[la[1]][1][1] - spacing + 1),
			Array(width, t[la[1]][1][1] + 1),
			Array(0, t[la[1]][1][1] + 1),
		));

		this.doc.activeLayer = l[la[0]];

		if (this.settings.mask_layers)
			tp_fill_layer_mask(BLACK);
		else
			this.doc.selection.clear();

		this.doc.activeLayer = l[la[1]];

		if (this.settings.mask_layers)
			tp_fill_layer_mask(BLACK);
		else
			this.doc.selection.clear();

		this.doc.selection.deselect();
	} else {
		for (i = 0; i < this.n; i++) {
			this.doc.selection.select(sel = Array(
				Array(t[i][1][0] - spacing + 1, 0),
				Array(t[i][1][0] - spacing + 1, height),
				Array(t[i][1][0] + 1, height),
				Array(t[i][1][0] + 1, 0),
			));
			
			if (sel[2][0] > 0)
				this.clear_selected();
		}
		if (this.tych_variant == QUAPTYCH_GRID) {
			this.doc.selection.select(sel = Array(
				Array(0, t[2][1][1] - spacing + 1),
				Array(width, t[2][1][1] - spacing + 1),
				Array(width, t[2][1][1] + 1),
				Array(0, t[2][1][1] + 1),
			));
			this.clear_selected();
		}
	}
}


/** 
 * Clears the selected area on all layers.
 *
 * If masks are enabled, layers are cleared by masking out the selected parts.
 */
Tych.prototype.clear_selected = function()
{
	for (j = 0; j < this.n; j++) {
		this.doc.activeLayer = this.doc.layers[j];

		if (tp_overlaps_selection(this.doc.activeLayer))
			if (this.settings.mask_layers)
				tp_fill_layer_mask(BLACK);
			else
				this.doc.selection.clear();
	}
	this.doc.selection.deselect();
}


Tych.prototype.get_jpeg_save_options = function()
{
	options = new JPEGSaveOptions();
	options.embedColorProfile = true;
	options.formatOptions = FormatOptions.STANDARDBASELINE;
	options.matte = MatteType.NONE;
	options.quality = this.settings.jpeg_quality;
	return options;
}


Tych.prototype.get_psd_save_options = function()
{
	options = new PhotoshopSaveOptions();
	options.layers = true;
	options.embedColorProfile = true;
	options.annotations = true;
	options.alphaChannels = true;
	options.spotColors = true;
	return options;
}


Tych.prototype.move_into_set = function(layers, set)
{
	activeDocument = layers[0].parent;
	for (i = 0; i < layers.length; i++)
		layers[i].move(set, ElementPlacement.INSIDE);
}


/*
Tych.prototype.test_copy = function()
{
	var i;
	for (i = 0; i < activeDocument.layers.length; i++) {
		//src.activeLayer = src.layers[i];
		$.writeln(i + ' hhj');
		this.copy_layer_to_document(activeDocument.layers[i], documents[0]);
		$.writeln(i + ' say what');

	}
}
*/

/**
 * Copies the specified layer to the bottom of the layer stack of the given
 * document.
 */
Tych.prototype.copy_layer_to_document = function(layer, target)
{
	activeDocument = layer.parent;
	var temp = layer.parent.activeLayer;
	layer.parent.activeLayer = layer;

	for (i = 0; i < documents.length; i++) {
		if (documents[i] == target)
			target_index = i;

		if (documents[i] == activeDocument)
			active_index = i;
	}

	// We must iterate through the document stack in order to copy the layer to
	// a specific document. It works by copying it one document at a time until
	// it's in the right document.
	for (i = active_index; i >= target_index; i--) {

		this.copy_layer_to_previous_document();

		if (i != active_index)
			// Remove when not the in target
			documents[i].activeLayer.remove();

		if (i - 1 == target_index) break;

		activeDocument = documents[i - 1];

	}
	activeDocument = layer.parent;
	layer.parent.activeLayer = temp;
}


/**
 * Copies the active layer of the active document to the document beneath it
 * in the document stack.
 */
Tych.prototype.copy_layer_to_previous_document = function()
{
	var desc = new ActionDescriptor();
	var ref = new ActionReference();

	ref.putEnumerated(
		charIDToTypeID('Lyr '),
		charIDToTypeID('Ordn'),
		charIDToTypeID('Trgt')
	);

	desc.putReference(charIDToTypeID('null'), ref);
	var docRef = new ActionReference();
	docRef.putOffset(charIDToTypeID('Dcmn'), -1);
	desc.putReference(charIDToTypeID('T   '), docRef);
	desc.putInteger(charIDToTypeID('Vrsn'), 5);
	executeAction(charIDToTypeID('Dplc'), desc, DialogModes.NO);
}


var t = new Tych(tp_get_settings());
//t.layout(QUAPTYCH_GRID);
//t.layout(TRIPTYCH_PORTRAIT_LANDSCAPE_GRID);
//t.layout(TRIPTYCH_LANDSCAPE_PORTRAIT_GRID);
//t.layout(QUAPTYCH_GRID);
//t.layout_and_composite();
//t.test_copy();
